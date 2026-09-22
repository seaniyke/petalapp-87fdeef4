/**
 * Edit scope guard — AI Generation Bible §9.
 *
 * "Every edit is diffed and the byte-delta recorded. Suspiciously large deltas
 *  on small requests are flagged before commit." And §13.1: "Never overwrite
 *  working code to satisfy an unrelated request."
 *
 * `diffChangedPaths()` answers *whether* anything changed. This answers whether
 * what changed is proportionate to what was asked. The classic defect it
 * catches: the user says "make the heading bigger" and the model returns a
 * from-scratch rewrite of six files, silently deleting working features.
 *
 * Pure and synchronous — no model call, no I/O. Flags are advisory to the
 * caller: disclose on a small overshoot, revert unrelated files on a large one.
 */

import type { ProjectFile } from "./generate.server";
import { isScaffoldOwnedPath, isScaffoldAbsorbedPath } from "./scaffold-ownership.server";

export interface FileDelta {
  path: string;
  beforeBytes: number;
  afterBytes: number;
  /** afterBytes - beforeBytes. Negative means the file shrank. */
  deltaBytes: number;
  kind: "added" | "removed" | "modified";
  /** Fraction of the original file that changed in size, 0..1+ for modified. */
  churn: number;
}

export interface ScopeReport {
  deltas: FileDelta[];
  totalDeltaBytes: number;
  changedCount: number;
  /** True when the request read as a small, targeted edit. */
  wasSmallRequest: boolean;
  /** Paths that shrank by more than half without being asked to. */
  shrunkPaths: string[];
  /** Paths rewritten wholesale (>70% churn) on a small request. */
  oversizedPaths: string[];
  /** True when the caller should disclose the overshoot to the user. */
  flagged: boolean;
  /** One-sentence, user-legible reason. Empty when not flagged. */
  reason: string;
}

/** Requests that read as "change this one visible thing". */
const SMALL_EDIT_HINTS =
  /\b(change|rename|tweak|adjust|fix|update|make|set|move|swap|replace|colou?r|font|size|bigger|smaller|bolder|padding|margin|spacing|wording|copy|text|label|title|heading|button|typo)\b/i;

const BIG_ASK_HINTS =
  /\b(rebuild|redesign|from scratch|start over|overhaul|revamp|restyle|re-?theme|new (app|site|page|design|look|theme|style)|add (a )?(dashboard|auth|payments|backend|footer|header|nav(bar)?|page|section)|migrate|refactor everything)\b/i;

/**
 * Broad surface asks: "change the entire website design", "give the whole app
 * a new look", "update every page". These legitimately rewrite many files —
 * treating them as small requests produced a bogus "that was a small ask, but
 * we rewrote a file end to end" scope warning on exactly the turns where a
 * wholesale rewrite is the correct answer.
 */
const BROAD_SURFACE_HINTS =
  /\b((entire|whole|full|complete)\s+(website|web\s?site|site|app|application|design|look|theme|ui|page)|(every|all)\s+(page|route|screen|component)s?|site\s*-?\s*wide|app\s*-?\s*wide|(change|update|switch|swap|give|make)\s+[\w\s]{0,24}?\b(design|theme|look|style|colou?r\s*(scheme|palette)|palette|branding|aesthetic)\b|\b(new|different|fresh)\s+(design|theme|look|style|palette|branding))\b/i;

/** A short prompt with edit verbs and no rebuild language is a small request. */
export function isSmallEditRequest(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length > 400) return false;
  if (BIG_ASK_HINTS.test(p)) return false;
  if (BROAD_SURFACE_HINTS.test(p)) return false;
  return SMALL_EDIT_HINTS.test(p);
}


const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Files whose size legitimately swings on tiny asks (generated/config). */
function isVolatilePath(path: string): boolean {
  return (
    path === "package.json" ||
    path === "index.html" ||
    path.endsWith(".lock") ||
    path.endsWith(".json") ||
    path.includes("vite.config") ||
    path.includes("tailwind.config")
  );
}

export function analyzeEditScope(
  before: ProjectFile[],
  after: ProjectFile[],
  prompt: string,
  /**
   * Optional verdict from the semantic edit classifier. The regexes above only
   * see the words; the classifier sees the intent. When it says "structural",
   * a wide rewrite is the correct answer and must never be flagged. When it
   * says "micro", a wide rewrite is a defect even if no keyword matched.
   */
  classifiedScope?: "micro" | "targeted" | "structural",
): ScopeReport {

  const prev = new Map(before.map((f) => [f.path, f.content]));
  const next = new Map(after.map((f) => [f.path, f.content]));

  const deltas: FileDelta[] = [];
  for (const [path, content] of next) {
    const old = prev.get(path);
    if (old === content) continue;
    const b = old === undefined ? 0 : bytes(old);
    const a = bytes(content);
    deltas.push({
      path,
      beforeBytes: b,
      afterBytes: a,
      deltaBytes: a - b,
      kind: old === undefined ? "added" : "modified",
      churn: b === 0 ? 1 : Math.abs(a - b) / b,
    });
  }
  for (const [path, content] of prev) {
    if (next.has(path)) continue;
    const b = bytes(content);
    deltas.push({
      path,
      beforeBytes: b,
      afterBytes: 0,
      deltaBytes: -b,
      kind: "removed",
      churn: 1,
    });
  }

  const wasSmallRequest =
    classifiedScope === "structural"
      ? false
      : classifiedScope === "micro" || isSmallEditRequest(prompt);
  const isNewProject = before.length === 0;


  const shrunkPaths = deltas
    .filter(
      (d) =>
        d.kind !== "added" &&
        !isVolatilePath(d.path) &&
        d.beforeBytes > 600 &&
        d.afterBytes < d.beforeBytes * 0.5,
    )
    .map((d) => d.path);

  const oversizedPaths =
    wasSmallRequest && !isNewProject
      ? deltas
          .filter((d) => d.kind === "modified" && !isVolatilePath(d.path) && d.churn > 0.7)
          .map((d) => d.path)
      : [];

  const removedPaths = deltas.filter((d) => d.kind === "removed").map((d) => d.path);

  const totalDeltaBytes = deltas.reduce((s, d) => s + d.deltaBytes, 0);
  const tooManyFiles = wasSmallRequest && !isNewProject && deltas.length > 4;

  let reason = "";
  if (!isNewProject) {
    if (shrunkPaths.length > 0) {
      reason = `${shrunkPaths.length === 1 ? "A file" : `${shrunkPaths.length} files`} shrank by more than half on this edit (${shrunkPaths.slice(0, 3).join(", ")}), which usually means working code was dropped rather than changed.`;
    } else if (oversizedPaths.length > 0) {
      reason = `That was a small ask, but ${oversizedPaths.slice(0, 3).join(", ")} ${oversizedPaths.length === 1 ? "was" : "were"} rewritten almost end to end.`;
    } else if (removedPaths.length > 0 && wasSmallRequest) {
      reason = `A small edit removed ${removedPaths.slice(0, 3).join(", ")}.`;
    } else if (tooManyFiles) {
      reason = `That edit touched ${deltas.length} files for what read as a one-thing change.`;
    }
  }

  return {
    deltas,
    totalDeltaBytes,
    changedCount: deltas.length,
    wasSmallRequest,
    shrunkPaths,
    oversizedPaths,
    flagged: reason.length > 0,
    reason,
  };
}

/** Chat disclosure text for a flagged turn. Bible §9: tell the user, always. */
export function scopeDisclosure(report: ScopeReport): string {
  if (!report.flagged) return "";
  return (
    `\n\nScope check — ${report.reason} ` +
    `If anything you had before is missing, say "undo that" and I'll roll this turn back.`
  );
}

/**
 * Prompt-side counterpart to the post-hoc guard.
 *
 * The guard above only ever *disclosed* an overshoot after the fact — the user
 * still paid for a turn that rewrote three working files to change a heading.
 * This block goes into the system context BEFORE the model writes anything, so
 * the surgical edit is the default and the full rewrite is the exception the
 * user has to actually ask for.
 *
 * Returns "" for structural asks (the cross-cutting completeness contract owns
 * those) and for initial builds.
 */
export function renderScopeContractBlock(args: {
  scope: "micro" | "targeted" | "structural";
  dimensions?: string[];
  targetPaths?: string[];
}): string {
  if (args.scope === "structural") return "";
  const targets = (args.targetPaths ?? []).filter(Boolean);
  const targetLine = targets.length
    ? `\nFiles this edit should touch: ${targets.join(", ")}. Anything outside that list needs a concrete reason (an import or type that would otherwise break).`
    : "";
  const dims = (args.dimensions ?? []).filter(Boolean);
  const dimLine = dims.length ? `\nWhat is changing: ${dims.join(", ")}.` : "";
  const ceiling =
    args.scope === "micro"
      ? "This is a one-thing change. Expect to edit ONE file, usually a single line or block."
      : "This is a targeted change. Expect to edit one page/section and, at most, the few files that must follow it.";

  return `\n\nEDIT SCOPE CONTRACT — read before emitting any op.
${ceiling}${dimLine}${targetLine}

Rules for this turn:
1. Prefer \`replace\` ops with a short, exact snippet copied verbatim from the file contents shown above. Do not retype code from memory.
2. Use a whole-file \`update\` ONLY when the change genuinely restructures that file. Never re-emit a file just to reformat it, reorder imports, rename internals, or "clean it up".
3. Do not touch files the request did not mention and that do not have to follow the change. Untouched working code must come back byte-identical.
4. Preserve everything already on the page — existing sections, props, routes, copy, handlers, styles and design tokens — unless the user asked for them to change. Deleting working behaviour to satisfy this request is a failure, not a simplification.
5. If the request is genuinely ambiguous about scope, make the smaller change and say in your recap what the wider version would be. Do not silently choose the rewrite.
6. Do the WHOLE ask though: every clause in the message must land. Small scope means few files, not a partial answer.`;
}
