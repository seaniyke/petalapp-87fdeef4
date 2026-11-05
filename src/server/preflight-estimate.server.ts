/**
 * Pre-flight cost estimator (Kimble "before-you-send").
 *
 * Differentiator: Bolt/Lovable users frequently complain about credits burning
 * on retries with no warning. We surface an estimated cost + duration BEFORE
 * the user hits send, so they can edit prompts that look expensive.
 *
 * Cheap implementation: one Lovable AI Gemini-Flash-Lite classification call
 * returning {kind, est_seconds, est_cents}. Cached client-side by prompt hash.
 *
 * Server-side helper. Wired through a createServerFn in
 * src/server/preflight-estimate.functions.ts so the client can import safely.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";

export type PreflightKind =
  | "ui_tweak"
  | "new_component"
  | "feature"
  | "backend_change"
  | "image_generation"
  | "refactor"
  | "discussion";

export type PreflightEstimate = {
  kind: PreflightKind;
  estSeconds: number;
  estCents: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
};

// Coarse cost map (USD cents) — tuned to be slightly conservative so users
// aren't surprised by higher actual costs.
const KIND_BASELINES: Record<PreflightKind, { sec: number; cents: number }> = {
  ui_tweak: { sec: 8, cents: 1 },
  new_component: { sec: 18, cents: 3 },
  feature: { sec: 45, cents: 8 },
  backend_change: { sec: 35, cents: 6 },
  image_generation: { sec: 12, cents: 4 },
  refactor: { sec: 30, cents: 5 },
  discussion: { sec: 5, cents: 0 },
};

export function fallbackEstimate(prompt: string): PreflightEstimate {
  // Heuristic when AI is unreachable
  const len = prompt.trim().length;
  let kind: PreflightKind = "ui_tweak";
  if (/\b(database|auth|signup|login|stripe|webhook|api|edge function)\b/i.test(prompt)) {
    kind = "backend_change";
  } else if (/\b(image|illustration|hero photo|generate.*image)\b/i.test(prompt)) {
    kind = "image_generation";
  } else if (/\b(refactor|reorganize|rewrite|clean up)\b/i.test(prompt)) {
    kind = "refactor";
  } else if (len > 240 || /\b(feature|page|flow|dashboard|admin)\b/i.test(prompt)) {
    kind = "feature";
  } else if (/\b(component|card|button|section|widget)\b/i.test(prompt)) {
    kind = "new_component";
  } else if (/^\s*(why|how|what|explain|tell me)/i.test(prompt)) {
    kind = "discussion";
  }
  const base = KIND_BASELINES[kind];
  const lengthBoost = Math.min(2, Math.floor(len / 200));
  return {
    kind,
    estSeconds: base.sec + lengthBoost * 5,
    estCents: base.cents + lengthBoost,
    confidence: "low",
    rationale: "Estimated locally without AI classification.",
  };
}

/**
 * Server-side estimate cache. The composer re-estimates on every pause in
 * typing, so the same prompt was being classified ~5x per turn. Keyed by the
 * exact trimmed prompt, bounded, with a short TTL.
 */
const ESTIMATE_CACHE = new Map<string, { at: number; value: PreflightEstimate }>();
const ESTIMATE_TTL_MS = 10 * 60 * 1000;
const ESTIMATE_CACHE_MAX = 500;

function cacheKey(prompt: string): string {
  return prompt.length > 4000 ? prompt.slice(0, 4000) : prompt;
}

function readCache(key: string): PreflightEstimate | null {
  const hit = ESTIMATE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ESTIMATE_TTL_MS) {
    ESTIMATE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: PreflightEstimate): void {
  if (ESTIMATE_CACHE.size >= ESTIMATE_CACHE_MAX) {
    const oldest = ESTIMATE_CACHE.keys().next().value;
    if (oldest) ESTIMATE_CACHE.delete(oldest);
  }
  ESTIMATE_CACHE.set(key, { at: Date.now(), value });
}

export async function estimatePromptCost(prompt: string): Promise<PreflightEstimate> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { kind: "discussion", estSeconds: 0, estCents: 0, confidence: "high", rationale: "Empty prompt." };
  }

  const key = cacheKey(trimmed);
  const cached = readCache(key);
  if (cached) return cached;

  if (!process.env.LOVABLE_API_KEY) {
    return fallbackEstimate(trimmed);
  }


  try {
    const res = await aiChatCompletions({
      feature: "preflight",
      body: {
        model: "google/gemini-3.1-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You classify a developer's chat prompt for an AI app builder. Return ONE category that best matches the work the AI assistant will need to do.",
          },
          { role: "user", content: trimmed.slice(0, 1200) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_prompt",
              description: "Classify the upcoming AI build task.",
              parameters: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [
                      "ui_tweak",
                      "new_component",
                      "feature",
                      "backend_change",
                      "image_generation",
                      "refactor",
                      "discussion",
                    ],
                    description:
                      "ui_tweak: small style/copy change. new_component: one new card/section. feature: multi-file or multi-step. backend_change: DB/auth/webhook/API. image_generation: hero/illustration. refactor: cleanup. discussion: question, no code.",
                  },
                  confidence: { type: "string", enum: ["low", "medium", "high"] },
                  rationale: {
                    type: "string",
                    description: "<= 12 words explaining the choice.",
                  },
                },
                required: ["kind", "confidence", "rationale"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_prompt" } },
      },
      // A classification miss has a good local fallback; a second paid call
      // is not worth it.
      noFallback: true,
    });

    if (!res.ok) {
      console.warn("[preflight-estimate] AI gateway returned", res.status);
      const local = fallbackEstimate(trimmed);
      writeCache(key, local);
      return local;
    }

    const data = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return fallbackEstimate(trimmed);
    const parsed = JSON.parse(args) as {
      kind: PreflightKind;
      confidence: "low" | "medium" | "high";
      rationale: string;
    };
    const base = KIND_BASELINES[parsed.kind] ?? KIND_BASELINES.feature;
    const lengthBoost = Math.min(2, Math.floor(trimmed.length / 200));
    const estimate: PreflightEstimate = {
      kind: parsed.kind,
      estSeconds: base.sec + lengthBoost * 5,
      estCents: base.cents + lengthBoost,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
    };
    writeCache(key, estimate);
    return estimate;

  } catch (e) {
    console.warn("[preflight-estimate] failed", e);
    return fallbackEstimate(trimmed);
  }
}
