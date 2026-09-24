import type { ProjectFile } from "@/server/generate.server";
import { diffChangedPaths } from "@/server/generate.server";
import { runAllRepairs } from "@/server/repair-all.server";
import { autofixFiles } from "@/server/stream-autofixer";
import { freshenStaleYears } from "@/server/freshen-stale-years.server";

export interface CleanupScopeMeta {
  turnId?: string | null;
  attemptId?: string | null;
  unitId?: string | null;
}

export interface ScopedCleanupResult {
  files: ProjectFile[];
  scope: string[];
  modified: string[];
  durationMs: number;
  skipped: boolean;
  notes: string[];
}

/**
 * Deterministic post-generation cleanup with a closed write boundary.
 *
 * The full graph remains available for import resolution, but only files
 * written by this generation turn and directly required resolver artifacts
 * may leave with different bytes. An absent/empty scope means "do nothing",
 * never "scan the whole project".
 */
export function runScopedBuildCleanup(
  files: ProjectFile[],
  changedPaths: readonly string[] | null | undefined,
  meta: CleanupScopeMeta = {},
): ScopedCleanupResult {
  const startedAt = Date.now();
  const existing = new Set(files.map((file) => file.path));
  const scope = Array.from(new Set(changedPaths ?? [])).filter((path) => existing.has(path));
  const prefix = `[cleanup-scope] turn=${meta.turnId ?? "none"} attempt=${meta.attemptId ?? "none"} unit=${meta.unitId ?? "none"}`;

  if (scope.length === 0) {
    const durationMs = Date.now() - startedAt;
    console.info(`${prefix} written=0 modified=0 cleanup=0 duration_ms=${durationMs} result=skipped skipped=true paths=[]`);
    return { files, scope, modified: [], durationMs, skipped: true, notes: [] };
  }

  const repaired = runAllRepairs(files, {
    scopeLock: { touchedPaths: scope },
    localOnly: true,
  });
  const autofixed = autofixFiles(repaired.files, scope);
  const freshened = freshenStaleYears(autofixed.files, undefined, scope);
  const modified = diffChangedPaths(files, freshened.files);
  const durationMs = Date.now() - startedAt;
  const notes = [
    ...repaired.notes,
    ...autofixed.report.notes,
    ...(freshened.replacements > 0
      ? [`freshened ${freshened.replacements} stale year reference(s)`]
      : []),
  ];
  console.info(
    `${prefix} written=${scope.length} modified=${modified.length} cleanup=${scope.length} duration_ms=${durationMs} result=${modified.length > 0 ? "fixed" : "ok"} skipped=false paths=${JSON.stringify(scope)}`,
  );
  return { files: freshened.files, scope, modified, durationMs, skipped: false, notes };
}