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
  actionKind: "retry" | "ask-fix" | "dismiss";
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
  title: "Petal got a bit confused",
  message: "Something didn't go right. Want to try that again?",
  actionLabel: "Try again",
  actionKind: "retry",
};

/**
 * Card lookup keyed on server-classified failure codes. Every `ErrorKind`
 * value MUST have an entry here.
 */
const KIND_TO_FRIENDLY: Record<ErrorKind, (raw: string) => FriendlyError> = {
  no_files_emitted: (raw) => ({
    title: "Petal didn't make any edits this turn",
    message:
      "The AI replied without writing files. Tap below — Petal will retry on a stronger model that's better at finishing the job.",
    actionLabel: "Retry on a stronger model",
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
    title: "Out of free generations",
    message:
      "We've used up today's free generations. Add credits in Settings → Workspace to keep going.",
    actionLabel: "Try again",
    actionKind: "retry",
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

  // Always log the original for our own debugging.
  console.error("[petal] generation/build error:", raw);

  // 1. Prefer the structured kind classified at the source. This bypasses
  //    all text matching — the server already decided what went wrong, so
  //    the client just renders the matching card. No more false positives
  //    from LLM-rewritten apology copy.
  if (raw instanceof PipelineError) {
    const builder = KIND_TO_FRIENDLY[raw.kind];
    if (builder && raw.kind !== "unknown") return builder(text);
    // kind === "unknown" → fall through to regex/generic, and report so
    // we can add a new branch.
  }

  // 2. Fall back to regex on RAW sources (build logs, fetch errors,
  //    JSON 400 bodies). Never matches humanized SSE prose.
  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      return p.build(text);
    }
  }

  // 3. Unmatched — generic card + telemetry so we can rank real failure
  //    modes that need a `kind`.
  reportPipelineFailure(text, ctx);
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
 *  AFTER the two free auto-fix attempts have been exhausted. At this
 *  point the user has to opt in to a manual fix (which IS charged like a
 *  normal build prompt) or open Discuss mode to investigate.
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
        "Petal already tried two free fixes and the build is still failing on a stylesheet issue. Tap below to try one more targeted fix.",
      actionLabel: "Try one more fix",
      actionKind: "ask-fix",
      technicalDetail: tail,
    };
  }

  return {
    title: "Petal couldn't auto-fix this one",
    message:
      "Two free fix attempts didn't resolve the build. Tap below to try one more pass with the latest error log, or open Discuss mode to investigate together.",
    actionLabel: "Try one more fix",
    actionKind: "ask-fix",
    technicalDetail: tail,
  };
}
