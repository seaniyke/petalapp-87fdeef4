/**
 * F1 — Preview state machine.
 *
 * The preview pane used to decide what to render with a chain of nested
 * ternaries spread over ~80 lines of JSX (`crashReason ? … : serverUrl ? …
 * : instantSrc && !instantDead ? … : …`). Every new case (frame refusal,
 * dev-server crash, install timeout) added another branch, and the states
 * silently overlapped — that's how "refused to connect" ended up rendering
 * behind a cheerful "Live edits warming up…" badge.
 *
 * This module is the single, pure decision point: give it everything we know
 * about the sandbox and the last deployment, and it returns exactly one state
 * with a user-facing reason attached. The component only renders it.
 *
 * Keeping it pure (no React) means the whole matrix is unit-testable and the
 * copy lives in one place instead of being retyped per branch.
 */

export type PreviewPhase =
  | "idle"
  | "booting"
  | "installing"
  | "starting"
  | "ready"
  | "error"
  | "unsupported";

export type PreviewStateKind =
  /** Browser can't run WebContainers at all (iOS Safari, some in-app browsers). */
  | "unsupported"
  /** The running app threw hard enough that we swapped in the crash card. */
  | "crashed"
  /** Live dev server inside the sandbox — the real thing. */
  | "live"
  /** Last deployed build, shown while the sandbox warms up behind it. */
  | "last_deployed"
  /** A deployment exists but the host won't let us frame it. */
  | "refused"
  /** Nothing to show yet; sandbox is working. */
  | "booting"
  /** Sandbox took too long — still working, but we say so honestly. */
  | "timed_out"
  /** Sandbox failed and there's no deployment to fall back to. */
  | "error";

export type PreviewState = {
  kind: PreviewStateKind;
  /** Short headline. Always plain language — never a raw log line. */
  title: string;
  /** One sentence of honest detail. `null` when the title says it all. */
  detail: string | null;
  /** URL to render in the iframe, when this state renders one. */
  src: string | null;
  /** Show the "still working" warming badge over the iframe. */
  warming: boolean;
  /** Offer a retry/reload affordance. */
  canRetry: boolean;
  /** Offer "Open in new tab" — the escape hatch when framing is blocked. */
  canOpenExternally: boolean;
};

export type PreviewStateInput = {
  phase: PreviewPhase;
  /** Dev-server URL from the sandbox, once it's listening. */
  serverUrl: string | null;
  /** Last deployed build URL, if the server-side probe said it's embeddable. */
  instantSrc: string | null;
  /** True once the deployed iframe proved dead client-side. */
  instantDead: boolean;
  /** C3 — why the probe rejected the deployed URL, if it did. */
  refusedReason: PreviewRefusalReason | null;
  /** Deployed URL we couldn't frame, so we can still offer "Open in new tab". */
  refusedUrl: string | null;
  /** C4 — structured dev-server / runtime crash reason. */
  crashReason: string | null;
  /** Free-text sandbox error (boot/install failure). */
  error: string | null;
  /** Seconds spent in a non-ready phase. Drives the timed-out state. */
  elapsedSec?: number;
};

export type PreviewRefusalReason =
  | "x_frame_options"
  | "frame_ancestors"
  | "unreachable"
  | `http_${number}`
  | (string & {});

/** Sandbox boots are slow but not *this* slow. Past this we stop pretending. */
export const PREVIEW_SLOW_AFTER_SEC = 90;

export function phaseLabel(phase: PreviewPhase): string {
  switch (phase) {
    case "booting":
      return "Starting the sandbox…";
    case "installing":
      return "Installing dependencies…";
    case "starting":
      return "Starting the dev server…";
    case "ready":
      return "Preview is live";
    case "error":
      return "Preview failed to start";
    case "unsupported":
      return "Preview not available in this browser";
    default:
      return "Getting things ready…";
  }
}

/** C3 — turn a probe verdict into something a person can act on. */
export function refusalCopy(reason: PreviewRefusalReason | null): string {
  if (!reason) return "This deployment can't be shown inside the builder.";
  if (reason === "x_frame_options" || reason === "frame_ancestors") {
    return "Your deployed app blocks being embedded in another page, so it can't render here. Open it in a new tab to see it.";
  }
  if (reason.startsWith("http_")) {
    return `The deployed URL answered with ${reason.slice(5)}. It may still be propagating — publish again if this sticks.`;
  }
  return "We couldn't reach the deployed URL. It may still be propagating.";
}

export function resolvePreviewState(input: PreviewStateInput): PreviewState {
  const {
    phase,
    serverUrl,
    instantSrc,
    instantDead,
    refusedReason,
    refusedUrl,
    crashReason,
    error,
    elapsedSec = 0,
  } = input;

  // Order matters: the most specific, most actionable state wins. Anything
  // below a match is unreachable by construction — that's the whole point of
  // replacing the ternary chain.
  if (phase === "unsupported") {
    return {
      kind: "unsupported",
      title: "Preview not available here",
      detail:
        error ??
        "This browser can't run the live sandbox. Your changes are saved and will run on a supported desktop browser.",
      src: null,
      warming: false,
      canRetry: false,
      canOpenExternally: false,
    };
  }

  if (crashReason) {
    return {
      kind: "crashed",
      title: "Your app crashed while running",
      detail: crashReason,
      src: null,
      warming: false,
      canRetry: true,
      canOpenExternally: false,
    };
  }

  if (serverUrl) {
    return {
      kind: "live",
      title: "Preview is live",
      detail: null,
      src: serverUrl,
      warming: false,
      canRetry: true,
      canOpenExternally: true,
    };
  }

  if (instantSrc && !instantDead) {
    return {
      kind: "last_deployed",
      title: "Showing your last published version",
      detail: phase === "error" ? "Live edits aren't running — reload to try the sandbox again." : null,
      src: instantSrc,
      // Don't promise warming when the sandbox already gave up.
      warming: phase !== "error" && phase !== "ready",
      canRetry: phase === "error",
      canOpenExternally: true,
    };
  }

  // C3 — a deployment exists but we can't frame it. Say why, and give the tab.
  if (refusedUrl) {
    return {
      kind: "refused",
      title: "Can't show your published app here",
      detail: refusalCopy(refusedReason),
      src: null,
      warming: false,
      canRetry: true,
      canOpenExternally: true,
    };
  }

  if (phase === "error") {
    return {
      kind: "error",
      title: "Preview failed to start",
      detail: error ?? "The sandbox couldn't start. Reload to try again.",
      src: null,
      warming: false,
      canRetry: true,
      canOpenExternally: false,
    };
  }

  if (elapsedSec >= PREVIEW_SLOW_AFTER_SEC) {
    return {
      kind: "timed_out",
      title: "This is taking longer than usual",
      detail: `${phaseLabel(phase)} Still going — you can keep chatting while it finishes.`,
      src: null,
      warming: true,
      canRetry: true,
      canOpenExternally: false,
    };
  }

  return {
    kind: "booting",
    title: phaseLabel(phase),
    detail: null,
    src: null,
    warming: true,
    canRetry: false,
    canOpenExternally: false,
  };
}

/**
 * C4 — map fatal dev-server stderr to a plain-language crash reason.
 *
 * Returns null for ordinary noise (warnings, deprecations, source maps) so
 * the log drawer keeps its normal job; only genuinely fatal output escalates
 * to the preview's crash state.
 */
export function classifyDevServerFailure(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (/^\s*(warn|warning|deprecat)/i.test(t)) return null;

  const missing = /Cannot find (?:module|package) ['"]([^'"]+)['"]|Failed to resolve import ["']([^"']+)["']/i.exec(t);
  if (missing) {
    const name = missing[1] ?? missing[2];
    return `The app imports "${name}" but that package isn't installed. Ask Petal to install it or remove the import.`;
  }
  if (/EADDRINUSE/i.test(t)) {
    return "The dev server port is already in use inside the sandbox. Reload the preview to restart it.";
  }
  if (/JavaScript heap out of memory|FATAL ERROR:.*heap/i.test(t)) {
    return "The dev server ran out of memory while building. Reload the preview, and ask Petal to simplify the heaviest page if it repeats.";
  }
  if (/\b(SyntaxError|Unexpected token|Expected .* but found)\b/i.test(t)) {
    return `The dev server couldn't parse your code: ${t.slice(0, 160)}`;
  }
  if (/Transform failed|Build failed with \d+ error/i.test(t)) {
    return `The build failed: ${t.slice(0, 160)}`;
  }
  if (/\[vite\].*(error|failed)/i.test(t) && !/hmr/i.test(t)) {
    return `Vite reported an error: ${t.slice(0, 160)}`;
  }
  return null;
}
