/**
 * Deterministic pre-triage.
 *
 * The LLM triage call costs 30–60s on a long prompt before the build
 * pipeline even starts. But most turns are not ambiguous at all: "build me
 * a hiking journal app", "make the hero bigger", "the form doesn't submit"
 * are unmistakably build/edit/fix. For those we can skip the model entirely
 * and hand the builder an intent in ~1ms.
 *
 * The bar for a fast-path hit is deliberately high: an explicit build/edit
 * verb (or an obvious "add X page" shape), no trailing question mark, no
 * high-stakes domain, and no image attachment. Anything else falls through
 * to the model, which stays the authority for nuance.
 */

const BUILD_VERBS =
  /\b(build|create|make|design|generate|scaffold|start|launch|develop)\b/i;

const EDIT_VERBS =
  /\b(add|change|update|edit|remove|delete|rename|replace|move|swap|increase|decrease|reduce|shrink|enlarge|tweak|adjust|hide|show|reorder|align|center|implement|enable|disable|translate|rewrite|reword|shorten|expand)\b/i;

const FIX_VERBS =
  /\b(fix|repair|broken|(?:doesn'?t|does not|won'?t|will not|can'?t|cannot)\s+\w+|not working|isn'?t working|crash(?:es|ing)?|error|bug|stuck|fails?|failing)\b/i;

const REDESIGN_VERBS =
  /\b(redesign|revamp|overhaul|restyle|re-?theme|modernize|make it (?:look|feel) (?:better|premium|modern))\b/i;

const CHAT_ONLY =
  /^(?:hi|hey|hello|yo|sup|thanks?|thank you|thx|ok(?:ay)?|cool|nice|great|good (?:morning|afternoon|evening)|gm|👋|🙏)[\s!.,]*$/i;

export type FastTriageMode = "build" | "edit" | "fix" | "redesign" | "chat";

export interface FastTriageHit {
  mode: FastTriageMode;
  scope: "tiny" | "small" | "medium" | "large";
  brief: string;
  reply: string;
}

export interface FastTriageInput {
  text: string;
  /** How many files the project already has. 0 ⇒ first build. */
  fileCount: number;
  /** Skip the fast path when the prompt touches a regulated/high-stakes domain. */
  highStakes: boolean;
  /** Skip when the turn carries an image — vision changes the read. */
  hasAttachment: boolean;
  /** Skip for non-English so the warm reply mirrors their language. */
  language: string;
}

/**
 * Returns a confident classification, or null when the model should decide.
 */
export function fastTriage(input: FastTriageInput): FastTriageHit | null {
  const text = (input.text ?? "").trim();
  if (!text) return null;
  if (input.highStakes || input.hasAttachment) return null;
  if (input.language && input.language !== "en") return null;
  if (text.length > 4000) return null;

  if (CHAT_ONLY.test(text)) {
    return {
      mode: "chat",
      scope: "tiny",
      brief: text.slice(0, 200),
      reply: "Hey! Tell me what you'd like to build and I'll get started.",
    };
  }

  // Anything phrased as a question may be asking ABOUT the app rather than
  // asking for a change — let the model read it.
  if (/\?/.test(text)) return null;
  // Multiple questions or hedging language ⇒ let the model read it.
  if (/\b(should i|which one|what do you think|not sure|maybe|or should)\b/i.test(text)) {
    return null;
  }

  const words = text.split(/\s+/).length;

  if (REDESIGN_VERBS.test(text) && input.fileCount > 0) {
    return {
      mode: "redesign",
      scope: "large",
      brief: text.slice(0, 300),
      reply: "Got it — giving it a fresh, more polished look now…",
    };
  }

  if (FIX_VERBS.test(text) && input.fileCount > 0) {
    return {
      mode: "fix",
      scope: words > 40 ? "medium" : "small",
      brief: text.slice(0, 300),
      reply: "Thanks — I see the problem. Fixing it now…",
    };
  }

  if (BUILD_VERBS.test(text) && words >= 4) {
    const isNew = input.fileCount === 0;
    return {
      mode: isNew ? "build" : "edit",
      scope: isNew ? "large" : words > 40 ? "medium" : "small",
      brief: text.slice(0, 300),
      reply: isNew
        ? "Love it — I'll put together a first version now…"
        : "On it — adding that now…",
    };
  }

  if (EDIT_VERBS.test(text) && input.fileCount > 0 && words >= 3) {
    return {
      mode: "edit",
      scope: words > 40 ? "medium" : words > 12 ? "small" : "tiny",
      brief: text.slice(0, 300),
      reply: "On it — making that change now…",
    };
  }

  return null;
}
