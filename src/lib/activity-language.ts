/**
 * Plain-English names for everything Kimble actually does during a turn.
 *
 * The build pipeline emits internal step ids ("rls_sanity", "image_resolve",
 * "post_stream_autofix", "esbuild_parse"…) with engineer-flavoured messages.
 * Those are useful in logs and useless in chat. This module is the single
 * place that turns a step into something the person who asked for the app
 * would actually say — so the activity card reflects what Kimble is really
 * doing right now, in words they recognise.
 *
 * Pure data in, data out. No React, no side effects.
 */

export type ActivityOutcome = "ok" | "fixed" | "skipped" | "failed";

export type HumanActivity = {
  /** One short line, sentence case, no jargon. */
  title: string;
  /** Optional one-line explanation, shown when the row is expanded. */
  detail?: string;
  /** Which part of the build this belongs to — used to keep the headline honest. */
  group: "planning" | "design" | "writing" | "checking" | "shipping";
};

const plural = (n: number | undefined, one: string, many: string) =>
  n === 1 ? one : many;

/**
 * Convert one pipeline step into something a person can read.
 * Unknown steps fall back to the server's own message.
 */
export function humanizeActivity(
  step: string,
  outcome: ActivityOutcome,
  message: string,
  count?: number,
): HumanActivity {
  const n = typeof count === "number" && count > 0 ? count : undefined;

  switch (step) {
    case "image_resolve":
      return {
        group: "design",
        title:
          outcome === "failed"
            ? "Couldn't make new pictures — used ready-made ones"
            : n
              ? `Made ${n} ${plural(n, "picture", "pictures")} for your app`
              : "Sorted out the pictures",
        detail: "Kimble creates the photos and artwork your pages need, then drops them in.",
      };

    case "rls_sanity":
      return {
        group: "checking",
        title:
          outcome === "ok"
            ? n
              ? `Checked ${n} ${plural(n, "file", "files")} for data privacy`
              : "Checked data privacy"
            : "Tightened who can see your saved data",
        detail: "Only the right people should be able to read or change anything you store.",
      };

    case "render_risk":
      return {
        group: "checking",
        title:
          outcome === "ok"
            ? n
              ? `Checked ${n} ${plural(n, "file", "files")} for crash risks`
              : "Checked for crash risks"
            : "Fixed things that could crash a page",
        detail: "Kimble opens each screen in its head and looks for anything that would break.",
      };

    case "esbuild_parse":
      return {
        group: "checking",
        title:
          outcome === "failed"
            ? "Rolled the change back to keep your app working"
            : n
              ? `Checked ${n} ${plural(n, "file", "files")} for errors`
              : "Checked the new code for errors",
        detail: "Nothing ships unless the whole app still builds.",
      };

    case "prd_contract":
      return {
        group: "checking",
        title:
          outcome === "failed"
            ? "Rolled it back — it didn't match what you asked for"
            : "Checked it matches what you asked for",
        detail: "Kimble compares the result against your brief before shipping it.",
      };

    case "npm_preflight":
      return {
        group: "writing",
        title: n ? `Added ${n} extra ${plural(n, "piece", "pieces")} your app needs` : "Added the extra pieces your app needs",
        detail: "Ready-made building blocks, installed so the new code can use them.",
      };

    case "local_verifier":
      return {
        group: "checking",
        title:
          outcome === "ok"
            ? n
              ? `Checked ${n} changed ${plural(n, "file", "files")}`
              : "Checked the changed files"
            : n
              ? `Found and fixed ${n} ${plural(n, "problem", "problems")} before you saw them`
              : "Found and fixed problems before you saw them",
        detail: "A code check of the files that changed. Running the real app happens after it's built.",
      };

    case "stream_autofix":
      return {
        group: "writing",
        title:
          outcome === "fixed"
            ? n
              ? `Tidied up ${n} small ${plural(n, "thing", "things")} while writing`
              : "Tidied up the code while writing"
            : "Quick safety check while writing — clean",
        detail: "Small slips get corrected as the code lands, not after.",
      };

    case "post_stream_autofix":
      return {
        group: "checking",
        title:
          outcome === "fixed"
            ? n
              ? `Repaired ${n} ${plural(n, "file", "files")}`
              : "Repaired a few files"
            : outcome === "failed"
              ? "Repair pass had trouble — kept the working version"
              : "Double-checked everything — nothing to repair",
        detail: "A second read over every new file.",
      };

    case "file_budget":
      return {
        group: "writing",
        title:
          outcome === "ok"
            ? "Kept every file a sensible size"
            : outcome === "failed"
              ? "One file got too big — finishing it in the next step"
              : "Trimmed a file that was getting too big",
        detail: "Huge files are slow and fragile, so Kimble splits the work instead.",
      };

    case "continuation":
      return {
        group: "writing",
        title: "Picked the work back up where it left off",
        detail: "Long changes run in stages so nothing gets cut off halfway.",
      };

    case "agent_tool":
      return {
        group: "writing",
        title: message || "Looked something up in your project",
        detail: "Kimble reads your existing code before changing it.",
      };

    default:
      return { group: "writing", title: message };
  }
}

export type ActivityLike = {
  step: string;
  outcome: ActivityOutcome;
  message: string;
  count?: number;
  /** Public URL when this event is a picture that just landed. */
  url?: string;
  ts: number;
};

/* ────────────────────────────────────────────────────────────────────────
 * Personality: the same true fact, said a few different ways.
 * A turn picks its phrasing from a seed so one build reads consistently,
 * but two builds never read identically.
 * ──────────────────────────────────────────────────────────────────────── */

/** Small stable hash → index. Pure, no randomness at render time. */
export function pick<T>(options: readonly T[], seed: string | number): T {
  const s = String(seed);
  let h = 7;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length] as T;
}

/** Live lines while a picture is being made or has just landed. */
export function pictureLine(index: number): string {
  return pick(
    [
      "That picture came out well",
      "Another picture, done",
      "Fresh artwork, just landed",
      "Made a picture for your app",
    ],
    `pic-${index}`,
  );
}

/**
 * Short in-character asides for the seconds where nothing new has landed,
 * so the card never freezes on a stale line. Phase-aware and never a
 * promise about progress.
 */
const IDLE_LINES: Record<string, readonly string[]> = {
  thinking: [
    "Working out the order of things…",
    "Reading your brief once more…",
    "Deciding which parts to touch…",
  ],
  designing: [
    "Trying a layout in my head…",
    "Lining up spacing and type…",
    "Settling on the colours…",
  ],
  writing: [
    "Still shaping this one…",
    "Getting the details right…",
    "Writing it out properly…",
  ],
  polishing: [
    "Reading it back line by line…",
    "Making sure nothing broke…",
    "Tidying the loose ends…",
  ],
  deploying: [
    "Putting it online…",
    "Nearly there…",
    "Packing it up for the web…",
  ],
};

export function idleLine(phaseId: string, seed: number): string | null {
  const lines = IDLE_LINES[phaseId];
  if (!lines) return null;
  return pick(lines, `${phaseId}-${seed}`);
}

/**
 * The newest thing Kimble did, in plain words — or null if nothing has
 * happened in the last `freshMs` (so a stale line never masquerades as live).
 */
export function latestActivityLine(
  events: ActivityLike[] | undefined,
  now = Date.now(),
  freshMs = 45_000,
): string | null {
  if (!events?.length) return null;
  const latest = events[events.length - 1];
  if (now - latest.ts > freshMs) return null;
  return humanizeActivity(latest.step, latest.outcome, latest.message, latest.count).title;
}
