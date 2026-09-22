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
  /**
   * Design Bible §10 — "If Kimble retries automatically, the card says so and
   * shows no retry button." Set this ONLY when the pipeline genuinely retries
   * without the user tapping anything. Copy and behaviour must agree.
   */
  autoRetrying?: boolean;
};

const FRIENDLY_ERROR_ACTIONS = new Set<NonNullable<FriendlyError["actionKind"]>>([
  "retry",
  "ask-fix",
  "dismiss",
  "buy-credits",
]);

/**
 * Persisted chat payloads are untrusted runtime data. Older/interrupted turns
 * can contain `error: {}` even though the TypeScript shape requires copy.
 * Rendering that object produces the empty amber "!" banner, so every entry
 * point uses this guard before storing or displaying an error card.
 */
export function isRenderableFriendlyError(value: unknown): value is FriendlyError {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<FriendlyError>;
  return (
    typeof error.title === "string" &&
    error.title.trim().length > 0 &&
    typeof error.message === "string" &&
    error.message.trim().length > 0 &&
    typeof error.actionLabel === "string" &&
    error.actionLabel.trim().length > 0 &&
    typeof error.actionKind === "string" &&
    FRIENDLY_ERROR_ACTIONS.has(error.actionKind as FriendlyError["actionKind"])
  );
}

/**
 * F3 error contract — the single producer of user-facing failure copy.
 * `toFriendlyError` is the only function allowed to turn an exception into
 * something a person reads, and `PetalErrorCard` is the only component
 * allowed to render it. Anything that shows `e.message` directly is a bug.
 *
 * Use this helper for the few surfaces that legitimately need a one-line
 * string (a toast for a transient, non-persisted failure) instead of a card.
 */
export function friendlyErrorText(raw: unknown, fallback: string): string {
  try {
    const friendly = toFriendlyError(raw);
    return friendly.title === "Kimble hit a build issue" ? fallback : friendly.message;
  } catch {
    return fallback;
  }
}

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
  title: "Kimble hit a build issue",
  message: "Kimble couldn't finish this pass safely. Retry and it will use a narrower edit path instead of guessing.",
  actionLabel: "Try again",
  actionKind: "retry",
};

/**
 * Card lookup keyed on server-classified failure codes. Every `ErrorKind`
 * value MUST have an entry here.
 */
const KIND_TO_FRIENDLY: Record<ErrorKind, (raw: string) => FriendlyError> = {
  no_files_emitted: (raw) => ({
    title: "Kimble needs a bit more to go on",
    message:
      "I couldn't tell what to build from that. Try describing the app in a sentence or two — what it does, who uses it, and one or two key features.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  no_edit_emitted: (raw) => ({
    title: "Kimble needs a sharper target",
    message:
      "Tell me the exact element or behavior to change (e.g. 'make the header sticky' or 'change the CTA color to teal') and I'll apply it precisely.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  // C7 — copy must match the button. These paths do NOT auto-retry, so the
  // copy no longer promises that Kimble will. It tells the user what tapping
  // the button will do instead.
  generation_incomplete: (raw) => ({
    title: "Kimble didn’t finish the update",
    message:
      "Kimble started the work but the generated files didn’t pass the final check, so nothing was changed. Tap below and Kimble will redo it as a smaller, safer edit.",
    actionLabel: "Retry safely",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  truncated_response: (raw) => ({
    title: "Kimble's reply got cut off",
    message:
      "The model ran out of room mid-build before the files were complete. Tap below and Kimble will rebuild it in smaller chunks.",
    actionLabel: "Retry safely",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  rate_limit: (raw) => ({
    title: "Kimble needs a quick breather",
    message: "We're getting a lot of requests right now. Try again in a moment.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  credits_exhausted: (raw) => ({
    title: "You're out of credits",
    message:
      "Your credit balance is empty, so Kimble couldn't run this build. Top up to keep generating — your project is safe and nothing was charged.",
    actionLabel: "Buy credits",
    actionKind: "buy-credits",
    technicalDetail: raw,
  }),
  provider_credits_exhausted: (raw) => ({
    title: "Kimble's AI is temporarily unavailable",
    message:
      "This one is on us, not you — Kimble's model provider is briefly out of capacity. Nothing was charged and your project is untouched. Try again shortly.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  upstream_unavailable: (raw) => ({
    title: "The AI was briefly unreachable",
    message:
      "Kimble couldn't reach the model just now — usually clears in a few seconds. Tap to try again.",
    actionLabel: "Try again",
    actionKind: "retry",
    technicalDetail: raw,
  }),
  upstream_timeout: (raw) => ({
    title: "Kimble ran out of time before saving changes",
    message:
      "Kimble took too long on this turn, so nothing was charged and no files were changed. Tap below to run it again on a tighter build path.",
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
    message: "You stopped Kimble. Send another message when you're ready.",
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
    // Platform-side exhaustion must be matched BEFORE the user-wallet
    // pattern below, otherwise our own gateway outage renders a "Buy
    // credits" CTA that cannot possibly fix it.
    test: /settings\s*(?:→|->|>)\s*workspace\s*(?:→|->|>)\s*usage|ai credits exhausted/i,
    build: (raw) => KIND_TO_FRIENDLY.provider_credits_exhausted(raw),
  },
  {
    // Credit-exhaustion safety net. Most credit-out paths now throw
    // PipelineError("credits_exhausted") via throwIfCreditsExhausted, but
    // this regex catches any plain Error that slips through — e.g. a
    // triage/discuss/coach 402 surfaced as `new Error(text)` where `text`
    // is `{"error":"You're out of credits..."}`. Without this the user
    // sees the generic "Kimble hit a build issue" card instead of the
    // dedicated "Buy credits" CTA.
    test: /\bout of credits\b|credits?\s+exhaust|insufficient.*(credit|balance)/i,
    build: (raw) => KIND_TO_FRIENDLY.credits_exhausted(raw),
  },
  {
    test: /\b(?:load failed|typeerror:\s*load failed|operation was aborted|lock:sb-.*auth-token|request stole it|error code:\s*1016)\b/i,
    build: (raw) => ({
      title: "Kimble is picking this back up",
      message: "Nothing is wrong with your app. Tap retry and Kimble continues from here.",
      actionLabel: "Try again",
      actionKind: "retry",
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
      message: "Kimble can build it, but it can't go online right now. We'll keep trying.",
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
      message: "Kimble forgot to add the main page. Let's try once more.",
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
      title: "Kimble's reply got cut off",
      message:
        "The AI ran out of room mid-file. Tap below and Kimble will retry with smaller, safer chunks — no extra credits.",
      actionLabel: "Retry safely",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // ESBuild parse failure with a precise location, e.g.
    // `src/routes/products/$slug.tsx:9:21: ERROR: Expected "from" but found …`
    // Name the file and line in plain language instead of the raw stack.
    test: /ERROR:\s*Expected\s+"[^"]+"\s+but found|Transform failed with \d+ error/i,
    build: (raw) => {
      const loc = raw.match(/([\w$./-]+\.(?:tsx?|jsx?)):(\d+):(\d+)/);
      const file = loc?.[1]?.replace(/^.*?(src\/)/, "$1") ?? "one of your files";
      const line = loc?.[2];
      const where = line ? `${file}, line ${line}` : file;
      return {
        title: "One line of code came out malformed",
        message: `Kimble wrote something the build can't read in ${where}. Tap below and Kimble will rewrite just that line — no extra credits.`,
        actionLabel: "Fix that line",
        actionKind: "ask-fix",
        technicalDetail: raw,
      };
    },
  },
  {
    // Vite/Rollup local-file resolution failure — build-log only.
    test: /Could not (?:resolve|load)\s+["']?(\.{1,2}\/|@\/)/i,
    build: (raw) => {
      const m = raw.match(/Could not (?:resolve|load)\s+["']?([^"'\s)]+)/i);
      const file = m?.[1] ?? "a missing file";
      return {
        title: "One file went missing",
        message: `Kimble referenced \`${file}\` but didn't create it. Tap below and Kimble will add it in one targeted fix.`,
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
        title: "That feature needs a package Kimble didn't include",
        message: `\`${pkg}\` isn't in the project. Tap below and Kimble will swap it for a built-in alternative.`,
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
        "Kimble wrote a CSS rule the build doesn't accept. Tap below and Kimble will rewrite it with safe defaults.",
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
  // Final safety net: every builder above must produce a renderable card.
  // A malformed payload (empty title/message) is what produced the blank
  // amber "!" banner bug, so anything that fails the contract falls back to
  // the generic card with the raw detail attached.
  const guard = (candidate: FriendlyError): FriendlyError =>
    isRenderableFriendlyError(candidate) ? candidate : { ...GENERIC, technicalDetail: text };

  if (raw instanceof PipelineError) {
    const builder = KIND_TO_FRIENDLY[raw.kind];
    if (builder && raw.kind !== "unknown") return guard(builder(rawText));
    // kind === "unknown" → fall through to regex/generic, and report so
    // we can add a new branch.
  }

  // 2. Fall back to regex on RAW sources (build logs, fetch errors,
  //    JSON 400 bodies). Never matches humanized SSE prose.
  for (const p of PATTERNS) {
    if (p.test.test(rawText)) {
      return guard(p.build(rawText));
    }
  }

  // 3. Unmatched — generic card + telemetry so we can rank real failure
  //    modes that need a `kind`. Prefer the server-provided RAW string
  //    (un-humanized) when available so pipeline_failures reflects the
  //    actual exception, not LLM apology copy.
  reportPipelineFailure(rawText, ctx);
  return { ...GENERIC, technicalDetail: text };
}

/**
 * Shared 402 → credits_exhausted helper for every client-side fetch helper
 * (stream.ts, triage.ts, discuss.ts, coach.ts). Call AFTER reading the
 * response body. Throws PipelineError("credits_exhausted") when the server
 * signals an empty wallet so the UI renders the dedicated "Buy credits"
 * card instead of the generic "Kimble hit a build issue" fallback.
 */
export function throwIfCreditsExhausted(resp: Response, rawText: string): void {
  if (resp.status !== 402) return;
  let friendly = "You're out of credits. Add credits to keep generating.";
  try {
    const parsed = JSON.parse(rawText) as { error?: string };
    if (parsed?.error) friendly = parsed.error;
  } catch {
    if (rawText && rawText.length < 240) friendly = rawText;
  }
  throw new PipelineError(friendly, "credits_exhausted", rawText);
}

/** Shown while Kimble is auto-fixing a failed build (Phase 2).
 *  This is purely informational — there's no action button because Kimble is
 *  already on it. After 2 attempts we fall back to `friendlyBuildFailure`
 *  with the manual "Ask Kimble to fix it" button.
 *
 *  Auto-fix runs are FREE — the server skips the credit charge for these
 *  turns (see `isAutoFix` in /api/generate). We say so explicitly here so
 *  users don't worry about runaway costs. */
export function autoFixingBuild(attempt: number): FriendlyError {
  return {
    title:
      attempt === 1
        ? "Kimble spotted a build error and is fixing it"
        : "Kimble is taking another shot at the fix",
    message:
      attempt === 1
        ? "No action needed — Kimble is reading the build log and patching the code. This fix is on us, no credits used."
        : "The first attempt didn't fully resolve it. Kimble is trying a different angle. Still free — no credits charged for auto-fixes.",
    actionLabel: "Working on it",
    actionKind: "dismiss",
    // This one really is automatic — the card says so and renders no button.
    autoRetrying: true,
  };
}

/** Friendly copy specifically for a failed Cloudflare Pages build, shown
 *  AFTER Kimble's free auto-fix attempts have been exhausted. At this
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
        "Your app is safe — one CSS rule is stopping the build. Tap “Try one more fix” and Kimble will repair it using this exact error.",
      actionLabel: "Try one more fix",
      actionKind: "ask-fix",

      technicalDetail: tail,
    };
  }

  return {
    title: "One thing is blocking the build",
    message:
      "Nothing is lost — your app and chat are safe. Tap “Try one more fix” and Kimble will send this exact error back to itself for a targeted pass. If it still fails, just tell Kimble what you wanted in the box below.",
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
    s.includes("build service didn't respond") ||
    s.includes("build service did not respond") ||
    s.includes("build service stopped responding") ||
    s.includes("builder unreachable") ||
    s.includes("build queue is full") ||
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
      "Your edit was saved, but the live preview couldn't refresh just now. Retry the build in a moment — don't ask Kimble to rewrite the app.",
    actionLabel: "Retry build",
    actionKind: "retry",
    technicalDetail: tail,
  };
}
