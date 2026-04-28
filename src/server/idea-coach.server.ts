/**
 * Idea Coach — server helper for /api/coach.
 *
 * Holds a tiny dialogue with the user that turns "I don't know what to build"
 * into a sharp, build-ready prompt. The coach asks at most 3-4 questions, each
 * answered either by tapping a chip or typing a short reply. The output is a
 * single `assembledPrompt` string the user can drop straight into the Build
 * composer.
 *
 * Design choices:
 * - Tool-calling for structured output (per AI Gateway guidance) instead of
 *   asking the model for raw JSON. Much more reliable.
 * - Cheap fast model (`google/gemini-3-flash-preview`) — we burn a coach turn
 *   in a couple of seconds and at trivial token cost.
 * - The route, not the model, decides when to stop. We hard-cap turns server-
 *   side so a misbehaving model can't keep the user spinning.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";

export type CoachTurnInput = {
  /** Index of THIS turn (1-based). Server caps at MAX_TURNS. */
  turn: number;
  /** Prior turns of the dialogue (oldest → newest). */
  history: CoachExchange[];
  /** What the user just said this turn — chip label or freeform text. */
  userInput: string;
};

export type CoachExchange = {
  /** Question Petal asked. */
  question: string;
  /** What the user answered (chip label or freeform). */
  answer: string;
};

export type CoachTurnOutput = {
  /** Next question to ask. Empty when isFinal=true. */
  question: string;
  /** 2-5 quick-pick chips. Empty when isFinal=true. */
  chips: string[];
  /** Running preview of the prompt — shown growing in the UI on every turn. */
  preview: string;
  /** True once the coach has produced the final, ready-to-build prompt. */
  isFinal: boolean;
  /** The assembled build prompt. Non-null only when isFinal=true. */
  assembledPrompt: string | null;
};

export const MAX_COACH_TURNS = 4;

const COACH_SYSTEM_PROMPT = `You are Petal's Idea Coach — a warm, briskly efficient brainstorming partner that helps a stuck user land on a single specific app idea they can build right now.

The user is sitting in front of an AI app builder and doesn't know what to make. Your only job is to ask 1-3 sharp questions, then hand back a concrete build prompt they can submit as-is.

Ground rules:
- One short question per turn. Plain language. No jargon.
- Always offer 3-5 tappable chip choices for the answer. Chips must be short (1-4 words), concrete, and meaningfully different from each other. The user can also type freely.
- Keep the running preview honest — only include details the user has actually committed to. Use ellipsis (…) for parts you haven't asked about yet.
- Stop early if you have enough. The MAX is 3 questions; ideally use 2.
- The final assembledPrompt must be a single paragraph (40-80 words), describe a small, focused MVP, and read as if a human wrote it directly into the composer. No bullet lists. No "I want…" framing — write it as a description: "A minimalist running log that…"
- Lean toward small, beautiful, finishable apps over kitchen-sink ideas.

You MUST reply by calling the coach_turn tool. Never reply with prose.`;

const COACH_TOOL = {
  type: "function" as const,
  function: {
    name: "coach_turn",
    description:
      "Reply to the user's last answer with either the next question + chip choices, or — if you have enough — the final assembled build prompt.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Single short question to ask the user next. Empty string when isFinal=true.",
        },
        chips: {
          type: "array",
          items: { type: "string", maxLength: 32 },
          minItems: 0,
          maxItems: 5,
          description:
            "2-5 short chip labels the user can tap as answers. Empty array when isFinal=true.",
        },
        preview: {
          type: "string",
          description:
            "A running preview of the prompt as it has been assembled so far, with ellipsis for parts not yet decided. 1-2 sentences.",
        },
        isFinal: {
          type: "boolean",
          description: "True only when the assembled prompt is ready to build with.",
        },
        assembledPrompt: {
          type: "string",
          description:
            "The final 40-80 word build prompt. MUST be present when isFinal=true. Empty string otherwise.",
        },
      },
      required: ["question", "chips", "preview", "isFinal", "assembledPrompt"],
      additionalProperties: false,
    },
  },
};

/** Call the AI gateway for one coach turn. Throws on transport failure;
 *  the caller is responsible for shaping non-2xx into a user-facing error. */
export async function coachTurn(input: CoachTurnInput): Promise<CoachTurnOutput> {
  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error("AI gateway is not configured");
  }

  const turnsLeft = Math.max(0, MAX_COACH_TURNS - input.turn);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    {
      role: "system",
      content: `You are on turn ${input.turn} of ${MAX_COACH_TURNS}. ${
        turnsLeft <= 1
          ? "This MUST be the final turn — set isFinal=true and produce assembledPrompt."
          : `You have at most ${turnsLeft} more turn(s) including this one. Prefer to wrap up early.`
      }`,
    },
  ];

  if (input.history.length === 0) {
    // First turn: there's no real prior dialogue. The "userInput" might be a
    // top-level seed picked from the welcome chips ("For my work", "Surprise
    // me", …) or a freeform sentence. Frame it for the model.
    messages.push({
      role: "user",
      content:
        input.userInput.trim().length > 0
          ? `I want to build something but I'm not sure what. Here's a hint to start from: "${input.userInput.trim()}". Ask me one focused question to narrow it down.`
          : "I want to build something but I'm not sure what. Ask me one focused question to start narrowing it down.",
    });
  } else {
    // Replay history, then append the new user input.
    for (const h of input.history) {
      messages.push({ role: "assistant", content: h.question });
      messages.push({ role: "user", content: h.answer });
    }
    messages.push({ role: "user", content: input.userInput.trim() });
  }

  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      tools: [COACH_TOOL],
      tool_choice: { type: "function", function: { name: "coach_turn" } },
      stream: false,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    const err = new Error(text || `AI gateway error (${upstream.status})`) as Error & {
      status?: number;
    };
    err.status = upstream.status;
    throw err;
  }

  const json = (await upstream.json()) as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { arguments?: string } }>;
      };
    }>;
  };

  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("Coach did not return a structured response.");

  let parsed: Partial<CoachTurnOutput>;
  try {
    parsed = JSON.parse(args) as Partial<CoachTurnOutput>;
  } catch {
    throw new Error("Coach response could not be parsed.");
  }

  // Defensive normalisation — model can drift on enum/empty fields.
  let isFinal = Boolean(parsed.isFinal);
  let assembledPrompt = (parsed.assembledPrompt ?? "").trim();
  // Force-finalise on the last allowed turn.
  if (input.turn >= MAX_COACH_TURNS && !isFinal) {
    isFinal = true;
    if (!assembledPrompt) {
      // Last-ditch fallback: synthesise a prompt from the preview + history so
      // the user always walks away with something usable.
      const summary = (parsed.preview ?? "").trim() || input.userInput.trim();
      assembledPrompt = summary
        ? `Build a small, focused web app: ${summary}. Keep it polished, mobile-first, and joyful.`
        : "Build a small, polished web app for me — surprise me with something delightful, mobile-first, and easy to use.";
    }
  }
  if (isFinal && !assembledPrompt) {
    isFinal = false; // can't be final without a prompt
  }

  return {
    question: (parsed.question ?? "").trim(),
    chips: Array.isArray(parsed.chips)
      ? parsed.chips.map((c) => String(c).trim()).filter(Boolean).slice(0, 5)
      : [],
    preview: (parsed.preview ?? "").trim(),
    isFinal,
    assembledPrompt: isFinal ? assembledPrompt : null,
  };
}
