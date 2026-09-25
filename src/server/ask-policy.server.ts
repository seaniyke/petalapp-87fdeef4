/**
 * Ask policy — "act like a senior engineer, don't interrogate".
 *
 * Kimble's ONLY question gate is `/api/triage` (mode = "clarify"). In practice
 * the model reached for clarify far too often: it asked about colours, brand,
 * scope, "do you want auth?", and — worst — asked again right after the user
 * had just answered a question. A senior engineer doesn't do that: they read
 * the request, commit to a sensible default, state the assumption, and build.
 *
 * This module is a deterministic, zero-cost pre-decision. It runs BEFORE the
 * triage model call so we can (a) instruct the model not to ask at all, and
 * (b) hard-downgrade a clarify that still slips through. Doing it before the
 * call matters: the warm reply streams token-by-token, so a question that is
 * only corrected after the stream would already be visible to the user.
 *
 * Pure functions, no I/O.
 */

export type AskDecision = {
  /** True ⇒ Kimble must act this turn, never ask. */
  forceAction: boolean;
  /** Short machine reason, for logs only. */
  reason:
    | "actionable-instruction"
    | "answering-a-question"
    | "repeat-request"
    | "detailed-request"
    | "none";
};

/** Verbs that make a message an instruction, not an open question. */
const ACTION_VERBS =
  /\b(build|create|make|design|generate|add|change|update|edit|remove|delete|rename|replace|move|swap|fix|repair|redesign|revamp|restyle|implement|wire|hook up|set ?up|install|enable|disable|increase|decrease|reduce|shrink|enlarge|tweak|adjust|hide|show|reorder|align|centre|center|translate|rewrite|reword|shorten|expand|connect|integrate|deploy|publish)\b/i;

/** The user is nudging us to get on with it. */
const REPEAT_REQUEST =
  /\b(just do it|go ahead|do it|proceed|continue|yes please|stop asking|don'?t ask|no more questions|use your judg?ement|you decide|whatever you think|surprise me|any(?:thing)? is fine)\b/i;

function textOf(content: unknown): string {
  return typeof content === "string" ? content : "";
}

/**
 * Decide, deterministically, whether this turn is allowed to ask a question.
 *
 * @param text          the user's latest message
 * @param messages      the recent conversation (oldest → newest)
 */
export function decideAskPolicy(
  text: string | null | undefined,
  messages: Array<{ role: string; content?: unknown }> = [],
): AskDecision {
  const t = (text ?? "").trim();
  if (!t) return { forceAction: false, reason: "none" };

  // 1. The user explicitly told us to stop asking / get on with it.
  if (REPEAT_REQUEST.test(t)) {
    return { forceAction: true, reason: "repeat-request" };
  }

  // 2. Never two questions in a row. If our previous turn ended in a
  //    question, this message is the answer — use it and build.
  const priorAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && textOf(m.content).trim().length > 0);
  if (priorAssistant && /\?\s*$/.test(textOf(priorAssistant.content).trim())) {
    return { forceAction: true, reason: "answering-a-question" };
  }

  // 3. A message carrying an action verb and not phrased as a question is an
  //    instruction. Act on it.
  const isQuestion = /\?\s*$/.test(t);
  if (!isQuestion && ACTION_VERBS.test(t)) {
    return { forceAction: true, reason: "actionable-instruction" };
  }

  // 4. A long, detailed brief already contains more than enough to start.
  //    Asking for more detail there is pure friction.
  if (!isQuestion && t.split(/\s+/).length >= 25) {
    return { forceAction: true, reason: "detailed-request" };
  }

  return { forceAction: false, reason: "none" };
}

/**
 * Final triage mode after the ask policy. The model may propose "clarify";
 * this is where that proposal is kept (a genuinely ambiguous request) or
 * converted into real work (the turn was never allowed to ask).
 */
export function resolveTriageMode<M extends string>(
  modelMode: M,
  policy: AskDecision,
  fileCount: number,
): { mode: M | "build" | "edit"; clarifyBlocked: boolean } {
  if (modelMode === "clarify" && policy.forceAction) {
    return { mode: fileCount === 0 ? "build" : "edit", clarifyBlocked: true };
  }
  return { mode: modelMode, clarifyBlocked: false };
}

/**
 * System-prompt addendum injected when questions are not allowed this turn.
 */
export function noAskInstruction(reason: AskDecision["reason"]): string {
  const because =
    reason === "answering-a-question"
      ? "The user is ANSWERING a question you just asked — never ask again immediately."
      : reason === "repeat-request"
        ? "The user has explicitly asked you to stop asking and proceed."
        : reason === "detailed-request"
          ? "The request is detailed enough to start from."
          : "This message is a clear instruction.";
  return `HARD RULE FOR THIS TURN: mode MUST NOT be "clarify". ${because} Choose build/edit/fix/redesign (or chat/explain if they are not requesting a change), pick sensible defaults for anything unstated, and do the work. Your reply must contain NO question mark.`;
}

/** Baseline posture appended to every triage call. */
export const SENIOR_ENGINEER_POSTURE = `HOW YOU THINK: you are a self-aware senior product engineer who owns this codebase. You already know its pages, components, data and design system, so you resolve vague references yourself ("the button at the top" → the hero CTA) instead of asking which one. Unstated details are decisions you are paid to make: naming, copy, colours, layout, spacing, sample content, which page a feature belongs on, whether something needs storage or sign-in. Make the call, state it in one short clause ("I'll put it on the pricing page"), and build. Asking the user to specify something you could reasonably choose is a failure, not politeness.`;

/**
 * Strip a trailing question from a reply that is no longer a clarify.
 * Keeps the warm tone but removes the dangling ask.
 */
export function stripQuestions(reply: string): string {
  const sentences = (reply ?? "").split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !s.trim().endsWith("?"));
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : "On it…";
}
