/**
 * Tier 3 — Phase classifier.
 *
 * Tags the user's latest turn as one of:
 *   implement | debug | refactor | plan | docs
 *
 * Routing matrix (used by /api/generate):
 *   implement → cheap+fast model (mechanical code writing)
 *   debug     → strong reasoning model
 *   refactor  → strong reasoning model
 *   plan      → strong reasoning model
 *   docs      → cheap+fast model
 *
 * Implementation: regex heuristic first (zero latency), AI fallback only
 * when ambiguous. The AI call uses gemini-flash-lite with tool calling,
 * capped to <50ms p50 in practice.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";

export type Phase = "implement" | "debug" | "refactor" | "plan" | "docs";

export interface PhaseTag {
  phase: Phase;
  confidence: "low" | "medium" | "high";
  source: "regex" | "ai" | "fallback";
}

const RX_DEBUG = /\b(bug|broken|error|fix|crash|doesn'?t work|not working|failing|undefined|nan|stuck|stack trace|exception|throw|throws)\b/i;
const RX_REFACTOR = /\b(refactor|reorganize|restructure|clean up|tidy|extract|split (?:the |this |out)|rename|move .* to|consolidate|deduplicate)\b/i;
const RX_PLAN = /\b(plan|architecture|design (?:approach|the system)|how (?:should|would|do) (?:i|we|you)|what'?s the best way|brainstorm|outline|roadmap|strategy)\b/i;
const RX_DOCS = /\b(doc|docs|documentation|readme|comment(?:s)?|explain (?:this|the code)|write up|describe (?:how|what))\b/i;
const RX_IMPLEMENT = /\b(add|build|create|make|implement|generate|new (?:page|component|route|button|form|section)|hook (?:up|it up)|wire up)\b/i;

/** Quick regex pass. Returns null when ambiguous and we should call the AI. */
export function classifyPhaseHeuristic(prompt: string): PhaseTag | null {
  const p = prompt.trim();
  if (!p) return { phase: "implement", confidence: "low", source: "fallback" };

  const hits: Phase[] = [];
  if (RX_DEBUG.test(p)) hits.push("debug");
  if (RX_REFACTOR.test(p)) hits.push("refactor");
  if (RX_PLAN.test(p)) hits.push("plan");
  if (RX_DOCS.test(p)) hits.push("docs");
  if (RX_IMPLEMENT.test(p)) hits.push("implement");

  // Single unambiguous match → high confidence.
  if (hits.length === 1) {
    return { phase: hits[0], confidence: "high", source: "regex" };
  }
  // No match → likely a small implement turn.
  if (hits.length === 0 && p.length < 120) {
    return { phase: "implement", confidence: "low", source: "regex" };
  }
  // Conflict (e.g. "fix the bug AND refactor") → defer to AI.
  return null;
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "tag_phase",
    description: "Tag the developer's chat turn with the work phase.",
    parameters: {
      type: "object" as const,
      properties: {
        phase: {
          type: "string",
          enum: ["implement", "debug", "refactor", "plan", "docs"],
          description:
            "implement: build/add new feature. debug: fix broken behavior. refactor: restructure existing code. plan: discuss approach without coding. docs: write/explain documentation.",
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["phase", "confidence"],
      additionalProperties: false,
    },
  },
};

export async function classifyPhase(prompt: string): Promise<PhaseTag> {
  const heuristic = classifyPhaseHeuristic(prompt);
  if (heuristic && heuristic.confidence !== "low") return heuristic;

  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return heuristic ?? { phase: "implement", confidence: "low", source: "fallback" };
  }

  try {
    // HARD TIMEOUT (4s). Same reasoning as design-director: the classifier
    // is a routing hint, not a build dependency. If the gateway is slow we
    // must NOT block the worker — fall back to the heuristic.
    const resp = await aiChatCompletions({
      feature: "preflight",
      body: {
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You tag a developer's chat prompt with ONE work phase. Be fast and decisive.",
          },
          { role: "user", content: prompt.slice(0, 800) },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "tag_phase" } },
        max_tokens: 80,
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      return heuristic ?? { phase: "implement", confidence: "low", source: "fallback" };
    }
    const data = (await resp.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return heuristic ?? { phase: "implement", confidence: "low", source: "fallback" };
    const parsed = JSON.parse(args) as { phase: Phase; confidence: "low" | "medium" | "high" };
    return { phase: parsed.phase, confidence: parsed.confidence, source: "ai" };
  } catch (e) {
    console.warn("[phase-classifier] failed:", e);
    return heuristic ?? { phase: "implement", confidence: "low", source: "fallback" };
  }
}

/**
 * Map a phase to a model preference. The caller still gets to override
 * (e.g. vision turns force a vision model). "cheap" = fast/cheap,
 * "smart" = strong reasoning.
 *
 * Tuning note (2026-05-04): `implement` was previously "cheap" which sent
 * almost every build through the flash model. That trades depth for speed
 * and the verifier pass-rate slipped to ~66%. We now route `implement` to
 * "smart" too — the smart router still falls back to fast when telemetry
 * shows fast wins, but the *default* errs on the side of doing the work
 * properly the first time (fewer auto-fix loops = fewer credits net).
 * Only `docs` stays cheap because it's mostly prose.
 */
export function modelTierForPhase(phase: Phase): "cheap" | "smart" {
  switch (phase) {
    case "docs":
      return "cheap";
    case "implement":
    case "debug":
    case "refactor":
    case "plan":
      return "smart";
  }
}
