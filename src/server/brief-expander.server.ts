/**
 * Brief expander.
 *
 * Vague first-build prompts ("surprise me", "build something", "an app",
 * "make me a website") are the #1 cause of `no_files_emitted` failures:
 * the model receives nothing concrete to scaffold and either bails to
 * prose or emits an empty tool call. We catch those briefs server-side
 * and expand them into a 1–2 sentence concrete project brief BEFORE
 * the main generation call ever sees them.
 *
 * Design notes:
 *   - Only runs on initial builds (currentFiles.length === 0). Patches
 *     have full project context and don't need expansion.
 *   - Heuristic gate FIRST (cheap), AI fallback SECOND. Most "fix the
 *     button" turns never trigger expansion.
 *   - Uses the cheapest model with a tight token budget (~250 out).
 *   - Failure-tolerant: on ANY error (network, timeout, parse) we return
 *     the original brief unchanged. Never blocks a build.
 *   - Output is structured via tool-calling, not free-form JSON, so we
 *     can't get tripped up by prose preambles.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";

const VAGUE_PATTERNS = [
  /^\s*surprise\s*me\s*[!.?]*\s*$/i,
  /^\s*build\s+(me\s+)?(an?\s+|some|something)/i,
  /^\s*make\s+(me\s+)?(an?\s+|some|something)/i,
  /^\s*create\s+(an?\s+)?(app|site|website|something)\s*[!.?]*\s*$/i,
  /^\s*(an?\s+)?(app|site|website|tool)\s*[!.?]*\s*$/i,
  /^\s*help\s+me\s+(build|make)/i,
  /^\s*idea\s*[!.?]*\s*$/i,
  /^\s*go\s*[!.?]*\s*$/i,
  /^\s*anything\s*[!.?]*\s*$/i,
];

export interface BriefExpansion {
  /** Whether expansion ran. False = original brief returned unchanged. */
  expanded: boolean;
  /** The brief the main model should see. */
  brief: string;
  /** Original user input, preserved for telemetry. */
  original: string;
  /** Why expansion did/didn't run — for logs. */
  reason: "too_short" | "vague_pattern" | "skipped_specific" | "skipped_long" | "ai_failed";
}

const MIN_SPECIFIC_CHARS = 40;
const MAX_TRIGGER_CHARS = 80;

function looksVague(text: string): boolean {
  const trimmed = text.trim();
  // CRITICAL: never trigger on length alone. "Build a car rental system"
  // (26 chars) is short but specific — expanding it produces a totally
  // different app (we shipped a collage app for that exact prompt). Only
  // the explicit vague patterns ("surprise me", "build something", etc.)
  // are allowed to trigger expansion.
  if (trimmed.length > MAX_TRIGGER_CHARS) return false;
  return VAGUE_PATTERNS.some((re) => re.test(trimmed));
}

const EXPANDER_TOOL = {
  type: "function" as const,
  function: {
    name: "expand_brief",
    description:
      "Turn a vague app idea into a concrete 1–2 sentence project brief that names the app type, the primary user action, and 2–3 key features. Avoid generic phrases like 'amazing' or 'beautiful'.",
    parameters: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description:
            "A concrete project brief, 25–60 words. Names the app type, the primary user action, and 2–3 specific features. Written as if the user typed it.",
        },
      },
      required: ["brief"],
      additionalProperties: false,
    },
  },
};

export async function expandBriefIfVague(input: string): Promise<BriefExpansion> {
  const original = input;
  const trimmed = input.trim();

  if (trimmed.length >= MIN_SPECIFIC_CHARS && !VAGUE_PATTERNS.some((re) => re.test(trimmed))) {
    return { expanded: false, brief: input, original, reason: "skipped_specific" };
  }
  if (trimmed.length > MAX_TRIGGER_CHARS) {
    return { expanded: false, brief: input, original, reason: "skipped_long" };
  }
  if (!looksVague(trimmed)) {
    return { expanded: false, brief: input, original, reason: "skipped_specific" };
  }

  try {
    const upstream = await aiChatCompletions({
      feature: "triage",
      body: {
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You turn vague app ideas into concrete project briefs that an AI app builder can scaffold. Pick a fun, specific app idea that fits the user's hint. Always call the expand_brief tool — never reply in prose.",
          },
          {
            role: "user",
            content: `User's vague request: "${trimmed}"\n\nGenerate a concrete brief.`,
          },
        ],
        tools: [EXPANDER_TOOL],
        tool_choice: { type: "function", function: { name: "expand_brief" } },
        max_tokens: 250,
        stream: false,
      },
      timeoutTier: "default",
      meta: { phase: "plan", promptChars: trimmed.length },
    });

    if (!upstream.ok) {
      console.warn("[brief-expander] upstream failed", upstream.status);
      return { expanded: false, brief: input, original, reason: "ai_failed" };
    }

    const json = (await upstream.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ function?: { arguments?: string } }>;
        };
      }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      return { expanded: false, brief: input, original, reason: "ai_failed" };
    }
    const parsed = JSON.parse(args) as { brief?: string };
    const brief = parsed.brief?.trim();
    if (!brief || brief.length < 20) {
      return { expanded: false, brief: input, original, reason: "ai_failed" };
    }

    console.log(
      `[brief-expander] expanded ${trimmed.length}c → ${brief.length}c: "${trimmed}" → "${brief.slice(0, 80)}…"`,
    );
    return {
      expanded: true,
      brief,
      original,
      reason: "vague_pattern",
    };
  } catch (e) {
    console.warn("[brief-expander] threw:", e);
    return { expanded: false, brief: input, original, reason: "ai_failed" };
  }
}
