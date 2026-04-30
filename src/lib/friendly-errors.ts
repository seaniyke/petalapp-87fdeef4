/**
 * Translate raw technical errors into warm, plain-English copy that
 * non-technical users can act on. Always log the original to the console
 * so we can still debug.
 *
 * Design rules:
 *  - No jargon: never expose "AI gateway", "502", "Cloudflare", "esbuild", etc.
 *  - Always end with a clear next step the user can take.
 *  - When unsure, fall back to a gentle generic message.
 */

import { reportPipelineFailure, type FailureReportContext } from "./report-failure";

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

const PATTERNS: Array<{
  test: RegExp;
  build: (raw: string) => FriendlyError;
}> = [
  {
    test: /rate.?limit/i,
    build: (raw) => ({
      title: "Petal needs a quick breather",
      message: "We're getting a lot of requests right now. Try again in a moment.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // Upstream AI provider hiccups (gateway 502/503/504, "bad gateway",
    // "upstream", "service unavailable"). These are transient and almost
    // always clear within a few seconds. Without this branch they fall
    // through to the generic "Petal got a bit confused" card, which is
    // misleading — the model never even responded.
    test: /\b(50[234])\b|bad gateway|upstream|service unavailable|gateway timeout|AI gateway error/i,
    build: (raw) => ({
      title: "The AI was briefly unreachable",
      message:
        "Petal couldn't reach the model just now — usually clears in a few seconds. Tap to try again.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    test: /credits?.*(exhaust|out|empty|low)|402/i,
    build: (raw) => ({
      title: "Out of free generations",
      message:
        "We've used up today's free generations. Add credits in Settings → Workspace to keep going.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    // The model returned prose instead of calling the write_project /
    // patch_files tool. Two surfaces produce this:
    //   1. Raw upstream errors from parseCollectedProject ("did not return a
    //      project", "returned no files/ops", "invalid project data").
    //   2. The LLM-rewritten apology copy from humanizeBuildError ("hit a
    //      snag", "took longer than expected", "ran out of time").
    // Both mean the same thing: the model bailed without producing edits.
    // Treat them as one failure mode with a clear retry CTA.
    test: /invalid project data|did not return a project|returned no (files|ops)|hit a snag|took (a bit )?longer than expected|ran out of (time|room)|wasn'?t able to finish|couldn'?t finish|tried to (rewrite|patch)/i,
    build: (raw) => ({
      title: "Petal didn't make any edits this turn",
      message:
        "The AI replied without writing files. Tap below — Petal will retry on a stronger model that's better at finishing the job.",
      actionLabel: "Retry on a stronger model",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
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
    test: /not signed in|unauthori[sz]ed|401/i,
    build: (raw) => ({
      title: "You've been signed out",
      message: "Please sign in again to continue.",
      actionLabel: "Sign in",
      actionKind: "dismiss",
      technicalDetail: raw,
    }),
  },
  {
    test: /could not reach build|reach builder|build service|fetch failed|network/i,
    build: (raw) => ({
      title: "Couldn't reach the publishing service",
      message: "Petal can build it, but it can't go online right now. We'll keep trying.",
      actionLabel: "Try again",
      actionKind: "retry",
      technicalDetail: raw,
    }),
  },
  {
    test: /aborted|cancell?ed/i,
    build: (raw) => ({
      title: "Stopped",
      message: "You stopped Petal. Send another message when you're ready.",
      actionLabel: "Dismiss",
      actionKind: "dismiss",
      technicalDetail: raw,
    }),
  },
  {
    // Server-side input cap rejections from /api/generate (8000 chars) or
    // /api/generate-image (500 chars). Both surface "too long" / "too large"
    // in the response body, so a single pattern catches both.
    test: /too long|too large|max(?:imum)?\s+\d+\s*chars?|prompt is too/i,
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
    // ESBuild syntax-truncation failures. Our telemetry shows these are the
    // single most common build-failure shape right now ("Unterminated string
    // literal", "Unterminated regular expression", "Unexpected end of file").
    // Cause: the model stopped streaming mid-file. The fix is the same in
    // every case — re-run the turn with a "split big files, finish closures"
    // nudge. The retry button on this card maps to that nudge in builder.tsx.
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
    // Vite/Rollup local-file resolution failure: the AI imported "./Foo" or
    // "@/components/Foo" but never created Foo. We can fix this with a single
    // targeted patch — the retry button routes to askPetalToFix(log) in
    // builder.tsx for this category.
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
    // Unresolved npm package — the AI imported something like "date-fns"
    // without it being in package.json. We can't auto-install, so the fix is
    // to swap for a built-in alternative (Date / Intl / lucide / our scaffold
    // utilities). askPetalToFix routes this to the model with the package
    // name explicitly called out.
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
    // Tailwind v4 / styles.css validation. Already surfaced via friendlyBuildFailure
    // for build-time, but if the same shape arrives via the generate path
    // (e.g. local-verifier flagged it), give a matching message here.
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

const GENERIC: FriendlyError = {
  title: "Petal got a bit confused",
  message: "Something didn't go right. Want to try that again?",
  actionLabel: "Try again",
  actionKind: "retry",
};

export function toFriendlyError(raw: unknown, ctx?: FailureReportContext): FriendlyError {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : JSON.stringify(raw);

  // Always log the original for our own debugging.

  console.error("[petal] generation/build error:", raw);

  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      return p.build(text);
    }
  }
  // Unmatched — this is the "Petal got a bit confused" path. Capture it so
  // we can rank the actual failure modes hitting users.
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
