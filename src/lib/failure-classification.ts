/**
 * Failure origin — ONE classification used by recovery and by the failure UX.
 *
 * An infrastructure or transport failure is never evidence about the user's
 * code: a provider 502 during a repair says nothing about whether the file
 * being repaired is valid. Recovery code must consult this before taking any
 * destructive action (isolating, reverting or deleting files).
 */

export type FailureOrigin =
  | "infrastructure" // AI provider / upstream API unavailable, timeouts, rate limits
  | "transport" // browser stream / socket dropped — observation lost, not work
  | "code" // syntax, types, missing import, build or runtime failure
  | "user_input" // a decision or credential only the user can supply
  | "cancelled" // explicit user stop
  | "in_progress" // a generation for this project is still running — follow it
  | "unknown";

/** Thrown by AI-backed recovery steps when the provider, not the code, failed. */
export class InfrastructureFailure extends Error {
  readonly origin = "infrastructure" as const;
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "InfrastructureFailure";
  }
}

export function isInfrastructureFailure(e: unknown): e is InfrastructureFailure {
  return e instanceof InfrastructureFailure || (typeof e === "object" && e !== null && (e as { origin?: unknown }).origin === "infrastructure");
}

/** HTTP status from an upstream provider → origin. 4xx other than the retryable ones is ours, not the code's. */
export function classifyHttpStatus(status: number): FailureOrigin {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "infrastructure";
  return "unknown";
}

const INFRA =
  /\b(50[0-4]|429|bad gateway|service unavailable|gateway time-?out|upstream|provider (error|unavailable|outage)|rate.?limit|overloaded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out|socket hang up|network error)\b/i;
const TRANSPORT =
  /\b(stream closed|no result payload|connection (interrupted|lost|closed)|websocket|sse|eventsource|reverb|load failed|network connection was lost)\b/i;
const CANCEL = /\b(abort(ed)?|cancell?ed|user stop|stopped by user)\b/i;
const USER = /\b(needs? (your|a) (decision|answer)|missing (secret|credential|api key)|connect (your|an) account)\b/i;
const CODE =
  /\b(TS\d{4}|SyntaxError|ReferenceError|TypeError|parse|unterminated|unexpected token|cannot find (module|name)|could not resolve|failed to resolve|missing import|not exported|build failed|compile|verification_failed|render)\b/i;

/** Classify any thrown value or recorded reason. Order matters: cancel > user > transport > infra > code. */
export function classifyFailureOrigin(input: unknown): FailureOrigin {
  if (isInfrastructureFailure(input)) return "infrastructure";
  if (typeof input === "object" && input !== null && typeof (input as { status?: unknown }).status === "number") {
    const byStatus = classifyHttpStatus((input as { status: number }).status);
    if (byStatus !== "unknown") return byStatus;
  }
  const text =
    input instanceof Error ? `${input.name} ${input.message}` : typeof input === "string" ? input : "";
  if (!text) return "unknown";
  if (CANCEL.test(text)) return "cancelled";
  if (USER.test(text)) return "user_input";
  if (TRANSPORT.test(text)) return "transport";
  if (INFRA.test(text)) return "infrastructure";
  if (CODE.test(text)) return "code";
  return "unknown";
}

/** Whether a failure of this origin may justify changing project files. Only code failures can. */
export function permitsDestructiveRecovery(origin: FailureOrigin): boolean {
  return origin === "code";
}

export type NextAction = "fix" | "continue" | "try_again" | "answer" | "follow" | null;

export interface FailureGuidance {
  origin: FailureOrigin;
  /** What happened, in plain words. */
  headline: string;
  /** What Kimble preserved. */
  preserved: string;
  /** The one semantic action that fits, or null when none is appropriate. */
  action: NextAction;
  actionLabel: string | null;
  /** Whether the user genuinely has to do something. */
  userMustAct: boolean;
}

export function guidanceFor(origin: FailureOrigin): FailureGuidance {
  switch (origin) {
    case "infrastructure":
      return {
        origin,
        headline: "The AI service was temporarily unavailable.",
        preserved: "Your project is exactly as it was — nothing was removed or charged.",
        action: "continue",
        actionLabel: "Continue",
        userMustAct: false,
      };
    case "transport":
      return {
        origin,
        headline: "The connection to the builder was interrupted.",
        preserved: "Kimble checks the saved result instead of guessing — no work is repeated and nothing is charged twice.",
        action: null,
        actionLabel: null,
        userMustAct: false,
      };
    case "code":
      return {
        origin,
        headline: "Kimble found a problem in the generated code.",
        preserved: "Your last working version is kept.",
        action: "fix",
        actionLabel: "Fix it",
        userMustAct: false,
      };
    case "user_input":
      return {
        origin,
        headline: "Kimble needs one decision before continuing.",
        preserved: "Everything so far is saved.",
        action: "answer",
        actionLabel: null,
        userMustAct: true,
      };
    case "in_progress":
      return {
        origin,
        headline: "Kimble is still working on your last request.",
        preserved: "Nothing new was started and nothing extra is charged.",
        action: "follow",
        actionLabel: "Keep watching",
        userMustAct: false,
      };
    case "cancelled":
      return {
        origin,
        headline: "Generation cancelled.",
        preserved: "Your previous verified version is kept exactly as it was.",
        action: null,
        actionLabel: null,
        userMustAct: false,
      };
    default:
      return {
        origin,
        headline: "Kimble couldn't finish this one.",
        preserved: "Your last working version is kept.",
        action: "try_again",
        actionLabel: "Try again",
        userMustAct: false,
      };
  }
}

/** Parse the origin carried in a turn outcome reason like "infrastructure:provider_unavailable". */
export function originFromReason(reason: string | null | undefined): FailureOrigin {
  if (!reason) return "unknown";
  const prefix = reason.split(":")[0];
  if (["infrastructure", "transport", "code", "user_input", "cancelled", "in_progress"].includes(prefix)) return prefix as FailureOrigin;
  return classifyFailureOrigin(reason);
}

/**
 * Server-classified pipeline kinds → origin. The kind is decided at the source
 * (`classifyRawError`), so this is a lookup, not a second classifier.
 */
export function originFromErrorKind(kind: string | null | undefined): FailureOrigin | null {
  switch (kind) {
    case "rate_limit":
    case "upstream_unavailable":
    case "provider_credits_exhausted":
      return "infrastructure";
    case "upstream_timeout":
      // Outcome unknown from the browser's side — persisted state decides.
      return "transport";
    case "aborted":
      return "cancelled";
    case "generation_running":
      return "in_progress";
    case "no_files_emitted":
    case "no_edit_emitted":
    case "credits_exhausted":
    case "unauthorized":
      return "user_input";
    case "generation_incomplete":
    case "truncated_response":
      return "code";
    default:
      return null;
  }
}

/** Whether a failure of this origin could have changed the user's project. Only code failures roll back a proposed change; nothing is committed on failure. */
export function projectChangedBy(_origin: FailureOrigin): false {
  // Every failure path rolls back through the turn transaction — a failed turn
  // never commits. Kept as a function so the UI states it from one place.
  return false;
}
