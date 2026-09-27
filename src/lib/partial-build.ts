/**
 * Partial first builds — one pure authority for "what successful work
 * survives a build that stopped before it was finished".
 *
 * Successful work = files the build wrote that passed their own validation.
 * They are already saved to the durable checkpoint as they finish. When the
 * build then stops (no progress, step budget, spending limit) without a
 * commit, that checkpoint is KEPT (resumable, marked partial) instead of
 * discarded, the kept work is billed through the existing effort price, and
 * the next attempt continues from it. Nothing uncommitted is ever put into
 * the project: the resumed turn re-runs every gate and the guarded commit.
 */

/** Loop outcomes that stop a build without it being wrong code. */
const PARTIAL_OUTCOMES = new Set(["no_progress", "incomplete", "breaker"]);

export function keepPartialWork(i: {
  isInitial: boolean;
  loopOutcome: string | null | undefined;
  committed: boolean;
  keptFiles: number;
}): boolean {
  return i.isInitial && !i.committed && i.keptFiles > 0 && PARTIAL_OUTCOMES.has(String(i.loopOutcome ?? ""));
}

/** Files written this turn that are present and validated clean. */
export function validatedWrites(
  written: string[],
  validation: Map<string, string[]>,
  files: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const out: Array<{ path: string; content: string }> = [];
  for (const p of new Set(written)) {
    const c = byPath.get(p);
    if (c === undefined) continue;
    if ((validation.get(p) ?? []).length > 0) continue;
    out.push({ path: p, content: c });
  }
  return out;
}

/** Terminal outcome stamped on a kept partial checkpoint. */
export const PARTIAL_OUTCOME = "partial";

/**
 * Effort-pricing baseline/target for a turn, so kept work is charged exactly
 * once: a partial turn is priced on baseline → baseline + kept files; a turn
 * resuming an already-billed partial checkpoint counts those files as its
 * baseline, so only new work is priced again.
 */
export function effortTrees(i: {
  baseline: Record<string, string>;
  committedTree: Record<string, string> | null;
  kept: Record<string, string> | null;
  resumedBilled: Record<string, string> | null;
}): { from: Record<string, string>; to: Record<string, string> } {
  const from = i.resumedBilled ? { ...i.baseline, ...i.resumedBilled } : i.baseline;
  if (i.committedTree) return { from, to: i.committedTree };
  if (i.kept) return { from, to: { ...from, ...i.kept } };
  return { from, to: from };
}
