/**
 * Translate raw technical errors into warm, plain-English copy that
 * non-technical users can act on. Always log the original to the console
 * so we can still debug.
 *
 * Design rules:
 *  - No jargon: never expose "AI gateway", "502", "Cloudflare", "esbuild", etc.
 *  - Always end with a clear next step the user can take.
 *  - When unsure, fall back to a gentle generic message.
 *
 * Architecture (post-refactor):
 *  We previously regexed the error TEXT to pick a friendly card. That broke
 *  the moment `humanizeBuildError` (a tiny LLM rewriter) returned an apology
 *  containing words like "too long", because the regex couldn't tell our own
 *  rewritten prose apart from a real input-cap rejection.
 *
 *  The fix: classify at the SOURCE. The server runs `classifyRawError` on
 *  the raw exception (before any LLM touches it) and ships a structured
 *  `kind` field on the SSE error event. The client passes that `kind`
 *  through `PipelineError` → `toFriendlyError`, which now looks up the
 *  card in `KIND_TO_FRIENDLY` and never inspects humanized prose.
 *
 *  Regex PATTERNS still exist — but only for raw error sources that have
 *  no `kind` (build-log failures, fetch network errors, JSON 400 bodies).
 *  Never add a regex that matches LLM-generated text.
 */

import { reportPipelineFailure, type FailureReportContext } from "./report-failure";
import type { ErrorKind } from "@/server/generate.server";

export type FriendlyError = {
  /** Short headline shown next to the warning icon. */
  title: string;
  /** One-line explanation in plain English. */
  message: string;
  /** What the user should do next, e.g. "Try again". */
  actionLabel: string;
  /** Which kind of action button to render. */
  actionKind: "retry" | "ask-fix" | "dismiss" | "buy-credits";
  /** Original technical detail — hidden behind a "Show details" disclosure. */
  technicalDetail?: string;
};

/**
 * Error subclass that carries the structured failure code from the server
 * through the throw/catch boundary. Use this anywhere we need to surface a
 * server-classified failure to the user without leaning on text matching.
 */
export class PipelineError extends Error {
  readonly kind: ErrorKind;
  /** Raw, un-humanized error string from the server (when available).
   *  Used for telemetry — the `message` field carries humanized prose
   *  so we keep the raw separately to avoid blinding root-cause analysis. */
  readonly raw?: string;
  constructor(message: string, kind: ErrorKind, raw?: string) {
    super(message);
    this.name = "PipelineError";
    this.kind = kind;
    this.raw = raw;
  }
}

const GENERIC: FriendlyError = {
  title: "Petal hit a build issue",
  message: "Petal couldn't finish this pass safely. Retry and it will use a narrower edit path instead of guessing.",
  actionLabel: "Try again",
  actionKind: "retry",
};

/**
 * Card lookup keyed on server-classified failure codes. Every `ErrorKind`
 * value MUST have an entry here.
 */
const KIND_TO_FRIENDLY: Record<ErrorKind, (raw: string) => FriendlyError> = {
  no_files_emitted: (raw) => ({
    title: "Petal needs a bit more to go on",
    message:
      "I couldn't tell what to build from that. Try describing the app in a sentence or two — what it does, who uses it, and one or two key features.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  no_edit_emitted: (raw) => ({
    title: "Petal needs a sharper target",
    message:
      "Tell me the exact element or behavior to change (e.g. 'make the header sticky' or 'change the CTA color to teal') and I'll apply it precisely.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  generation_incomplete: (raw) => ({
    title: "Petal didn’t finish the update",
    message:
      "Petal started the work but the generated files didn’t pass the final check. I’ll retry with a safer, smaller update.",
    actionLabel: "Retry safely",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  truncated_response: (raw) => ({
    title: "Petal's reply got cut off",
    message:
      "The model ran out of room mid-build before files were complete. Petal retries this with smaller chunks automatically.",
    actionLabel: "Retry safely",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  rate_limit: (raw) => ({
    title: "Petal needs a quick breather",
    message: "We're getting a lot of requests right now. Try again in a moment.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  credits_exhausted: (raw) => ({
    title: "You're out of credits",
    message:
      "Your credit balance is empty, so Petal couldn't run this build. Top up to keep generating — your project is safe and nothing was charged.",
    actionLabel: "Buy credits",
    actionKind: "buy-credits",
    technicalDetail: raw,
  }),
  upstream_unavailable: (raw) => ({
    title: "The AI was briefly unreachable",
    message:
      "Petal couldn't reach the model just now — usually clears in a few seconds. Tap to try again.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  upstream_timeout: (raw) => ({
    title: "Petal ran out of time before saving changes",
    message:
      "Petal took too long on this turn, so nothing was charged and no files were changed. I’ll retry with a tighter, safer build path.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  unauthorized: (raw) => ({
    title: "You've been signed out",
    message: "Please sign in again to continue.",
    actionLabel: "Sign in",
    actionKind: "dismiss",
    technicalDetail: raw,
  }),
  aborted: (raw) => ({
    title: "Stopped",
    message: "You stopped Petal. Send another message when you're ready.",
    actionLabel: "Dismiss",
    actionKind: "dismiss",
    technicalDetail: raw,
  }),
  unknown: (raw) => ({ ...GENERIC, technicalDetail: raw }),
};


/**
 * Regex matchers for RAW error sources only — i.e. errors that arrive
 * WITHOUT a structured `kind` from the server. Examples:
 *   - JSON 400 bodies from /api/generate (input caps)
 *   - Build-log failures from Cloudflare Pages (esbuild, rollup, tailwind)
 *   - Fetch/network errors thrown before the SSE stream starts
 *
 * NEVER add a regex here that matches LLM-generated apology text. If a
 * generation-path failure needs a new card, add a new value to `ErrorKind`
 * and classify it server-side in `classifyRawError`.
 */
const PATTERNS: Array<{
  test: RegExp;
  build: (raw: string) => FriendlyError;
}> = [
  {
    // Credit-exhaustion safety net. Most credit-out paths now throw
    // PipelineError("credits_exhausted") via throwIfCreditsExhausted, but
    // this regex catches any plain Error that slips through — e.g. a
    // triage/discuss/coach 402 surfaced as `new Error(text)` where `text`
    // is `{"error":"You're out of credits..."}`. Without this the user
    // sees the generic "Petal hit a build issue" card instead of the
    // dedicated "Buy credits" CTA.
    test: /\bout of credits\b|credits?\s+exhaust|insufficient.*(credit|balance)/i,
    build: (raw) => KIND_TO_FRIENDLY.credits_exhausted(raw),
  },
  {
    test: /\b(?:load failed|typeerror:\s*load failed|operation was aborted|lock:sb-.*auth-token|request stole it|error code:\s*1016)\b/i,
    build: (raw) => ({
      title: "Petal lost the connection for a moment",
      message:
        "This was a temporary connection issue, not a problem with your app. Tap retry and Petal will pick it back up safely.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // Server-side input cap rejection (JSON 400 from /api/generate or
    // /api/generate-image). Anchored to the exact wording emitted by those
    // routes so we never match humanized prose.
    test: /\b(?:your message is too long|prompt is too long)\b|max(?:imum)?\s+\d+\s*chars?/i,
    build: (raw) => ({
      title: "That message is a bit too long",
      message:
        "Try splitting it into smaller asks — Petal works best with one focused change at a time.",
      actionLabel: "Dismiss",
      actionKind: "dismiss",
      technicalDetail: raw,
    }),
  },
  {
    // Network/transport failures BEFORE the SSE stream — e.g. user offline,
    // publishing service unreachable. Server-classified upstream errors flow
    // through `kind: "upstream_unavailable"` instead.
    test: /could not reach build|reach builder|build service|fetch failed|network error|failed to fetch/i,
    build: (raw) => ({
      title: "Couldn't reach the publishing service",
      message: "Petal can build it, but it can't go online right now. We'll keep trying.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // Build-log shape: missing entry HTML.
    test: /missing index\.html/i,
    build: (raw) => ({
      title: "Something's missing",
      message: "Petal forgot to add the main page. Let's try once more.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // ESBuild syntax-truncation failures from build logs ("Unterminated
    // string literal", "Unexpected end of file"). These arrive via
    // friendlyBuildFailure / triggerBuild rejection — never with a `kind`.
    test: /Unterminated (?:string|regular expression|template)|Unexpected end of file/i,
    build: (raw) => ({
      title: "Petal's reply got cut off",
      message:
        "The AI ran out of room mid-file. Tap below and Petal will retry with smaller, safer chunks — no extra credits.",
      actionLabel: "Retry safely",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // Vite/Rollup local-file resolution failure — build-log only.
    test: /Could not (?:resolve|load)\s+["']?(\.{1,2}\/|@\/)/i,
    build: (raw) => {
      const m = raw.match(/Could not (?:resolve|load)\s+["']?([^"'\s)]+)/i);
      const file = m?.[1] ?? "a missing file";
      return {
        title: "One file went missing",
        message: `Petal referenced \`${file}\` but didn't create it. Tap below and Petal will add it in one targeted fix.`,
        actionLabel: "Add the missing file",
        actionKind: "ask-fix",
        technicalDetail: raw,
      };
    },
  },
  {
    // Unresolved npm package — build-log only.
    test: /Rollup failed to resolve import\s+["']([^"']+)["']/i,
    build: (raw) => {
      const m = raw.match(/Rollup failed to resolve import\s+["']([^"']+)["']/i);
      const pkg = m?.[1] ?? "an external package";
      return {
        title: "That feature needs a package Petal didn't include",
        message: `\`${pkg}\` isn't in the project. Tap below and Petal will swap it for a built-in alternative.`,
        actionLabel: "Use a built-in alternative",
        actionKind: "ask-fix",
        technicalDetail: raw,
      };
    },
  },
  {
    // Tailwind v4 / styles.css validation — build-log only.
    test: /Invalid declaration|Cannot apply unknown utility|@tailwindcss\/vite/i,
    build: (raw) => ({
      title: "A styling rule isn't quite right",
      message:
        "Petal wrote a CSS rule the build doesn't accept. Tap below and Petal will rewrite it with safe defaults.",
      actionLabel: "Fix the styles",
      actionKind: "ask-fix",
      technicalDetail: raw,
    }),
  },
];

export function toFriendlyError(raw: unknown, ctx?: FailureReportContext): FriendlyError {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : JSON.stringify(raw);
  const rawText = raw instanceof PipelineError && raw.raw ? raw.raw : text;

  // Always log the original for our own debugging.
  console.error("[petal] generation/build error:", raw);

  // 1. Prefer the structured kind classified at the source. This bypasses
  //    all text matching — the server already decided what went wrong, so
  //    the client just renders the matching card. No more false positives
  //    from LLM-rewritten apology copy.
  if (raw instanceof PipelineError) {
    const builder = KIND_TO_FRIENDLY[raw.kind];
    if (builder && raw.kind !== "unknown") return builder(rawText);
    // kind === "unknown" → fall through to regex/generic, and report so
    // we can add a new branch.
  }

  // 2. Fall back to regex on RAW sources (build logs, fetch errors,
  //    JSON 400 bodies). Never matches humanized SSE prose.
  for (const p of PATTERNS) {
    if (p.test.test(rawText)) {
      return p.build(rawText);
    }
  }

  // 3. Unmatched — generic card + telemetry so we can rank real failure
  //    modes that need a `kind`. Prefer the server-provided RAW string
  //    (un-humanized) when available so pipeline_failures reflects the
  //    actual exception, not LLM apology copy.
  reportPipelineFailure(rawText, ctx);
  return { ...GENERIC, technicalDetail: text };
}

/** Shown while Petal is auto-fixing a failed build (Phase 2).
 *  This is purely informational — there's no action button because Petal is
 *  already on it. After 2 attempts we fall back to `friendlyBuildFailure`
 *  with the manual "Ask Petal to fix it" button.
 *
 *  Auto-fix runs are FREE — the server skips the credit charge for these
 *  turns (see `isAutoFix` in /api/generate). We say so explicitly here so
 *  users don't worry about runaway costs. */
export function autoFixingBuild(attempt: number): FriendlyError {
  return {
    title:
      attempt === 1
        ? "Petal spotted a build error and is fixing it"
        : "Petal is taking another shot at the fix",
    message:
      attempt === 1
        ? "No action needed — Petal is reading the build log and patching the code. This fix is on us, no credits used."
        : "The first attempt didn't fully resolve it. Petal is trying a different angle. Still free — no credits charged for auto-fixes.",
    actionLabel: "Working on it",
    actionKind: "dismiss",
  };
}

/** Friendly copy specifically for a failed Cloudflare Pages build, shown
 *  AFTER Petal's free auto-fix attempts have been exhausted. At this
 *  point the user has to opt in to another manual fix pass or open Discuss
 *  mode to investigate.
 *
 *  We pass the raw log into the friendly error so the user can read it
 *  under "Show details" — and `askPetalToFix` in builder.tsx forwards the
 *  same log to the AI as the next prompt.
 *
 *  We sniff for a few well-known failure shapes (CSS / Tailwind, missing
 *  imports, TypeScript) so the user gets a hint about WHICH layer broke,
 *  not just "your app needs a fix". The AI still sees the full log. */
export function friendlyBuildFailure(rawLog: string | null | undefined): FriendlyError {
  if (rawLog) {
    console.error("[petal] build failed:", rawLog);
  }
  // Show the most useful tail (compilers put the error at the bottom).
  const tail = rawLog ? rawLog.split("\n").slice(-40).join("\n").slice(-2500) : undefined;

  // Tailwind v4 aborts the whole build on any invalid CSS. The error always
  // mentions the @tailwindcss/vite plugin and "Invalid declaration" / a
  // styles.css path. Surface it as a styling issue so the user knows what's
  // about to be fixed.
  const isCssError =
    !!rawLog &&
    (/@tailwindcss\/vite/i.test(rawLog) ||
      /Invalid declaration/i.test(rawLog) ||
      /Cannot apply unknown utility/i.test(rawLog) ||
      /styles\.css/i.test(rawLog));
  if (isCssError) {
    return {
      title: "A styling rule isn't quite right",
      message:
        "Petal tried free fixes, but the latest build still has a stylesheet error. Tap below to run one more targeted pass.",
      actionLabel: "Try one more fix",
      actionKind: "ask-fix",
      technicalDetail: tail,
    };
  }

  return {
    title: "Build needs one more pass",
    message:
      "Petal tried free fixes, but the latest build still has an error. Tap below to run one more targeted pass with the latest log, or open Discuss mode to investigate together.",
    actionLabel: "Try one more fix",
    actionKind: "ask-fix",
    technicalDetail: tail,
  };
}

/**
 * Detect build failures that are NOT the user's code — they're infrastructure
 * problems (build service unreachable, Cloudflare blocking, upstream 5xx).
 * These should NEVER trigger the AI auto-fix loop, because there's nothing in
 * the project files to fix. Instead we show a calm "service is busy, retry"
 * card and let the user re-trigger the build manually.
 */
export function isInfrastructureBuildError(rawLog: string | null | undefined): boolean {
  if (!rawLog) return false;
  const s = rawLog.toLowerCase();
  return (
    s.includes("could not reach build service") ||
    s.includes("builder rejected request") ||
    s.includes("failed to reach builder") ||
    s.includes("operation was aborted") ||
    s.includes("error code: 1000") ||
    s.includes("error code: 1016") ||
    s.includes("error code: 1020") ||
    s.includes("cloudflare") ||
    /\b(403|429|502|503|504|530)\b/.test(s) && (s.includes("builder") || s.includes("build service") || s.includes("upstream"))
  );
}

/** Friendly card for infrastructure build failures — no auto-fix, just retry. */
export function friendlyBuildServiceBusy(rawLog: string | null | undefined): FriendlyError {
  if (rawLog) console.warn("[petal] build service unavailable:", rawLog);
  const tail = rawLog ? rawLog.split("\n").slice(-20).join("\n").slice(-1500) : undefined;
  return {
    title: "Build service is briefly unavailable",
    message:
      "Your edit was saved, but the live preview couldn't refresh just now. Retry the build in a moment — don't ask Petal to rewrite the app.",
    actionLabel: "Retry build",
    actionKind: "retry",
    technicalDetail: tail,
  };
}
