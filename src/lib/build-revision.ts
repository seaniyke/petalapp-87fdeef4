/**
 * Project CODE revision identity (Prompt 11).
 *
 * `projects.revision` is the one identity of the current project code. It is
 * advanced only by the database, in the same transaction that changes
 * `project_files` (replace_project_files, or the per-statement file triggers).
 * Builds record the revision they were packed from; a result for any other
 * revision — or for a legacy build with no recorded revision — may be kept as
 * history but can never make the current project ready, repoint its current
 * build, or be published as the current code.
 *
 * Pure and client-safe.
 */

export type BuildRevisionStatus =
  | { current: true }
  | { current: false; reason: "legacy_unknown_revision" | "superseded"; buildRevision: number | null; projectRevision: number };

export function buildRevisionStatus(
  build: { project_revision?: number | string | null },
  project: { revision: number | string },
): BuildRevisionStatus {
  const projectRevision = Number(project.revision);
  const raw = build.project_revision;
  if (raw === null || raw === undefined) {
    return { current: false, reason: "legacy_unknown_revision", buildRevision: null, projectRevision };
  }
  const buildRevision = Number(raw);
  if (buildRevision !== projectRevision) {
    return { current: false, reason: "superseded", buildRevision, projectRevision };
  }
  return { current: true };
}

/** Human line for a stale result (stored on the build row, not shown as an error). */
export function staleReasonText(s: Exclude<BuildRevisionStatus, { current: true }>): string {
  return s.reason === "legacy_unknown_revision"
    ? `build has no recorded code revision (project is at revision ${s.projectRevision})`
    : `build is for revision ${s.buildRevision}; project is at revision ${s.projectRevision}`;
}

/** The save RPC's optimistic-concurrency rejection. */
export function isRevisionConflict(message: string | null | undefined): boolean {
  return !!message && /revision_conflict/i.test(message);
}

/**
 * The UI view of a build snapshot for the CURRENT project code. Derived only
 * from the two authoritative server values (projects.revision and
 * project_builds.project_revision) — no separate client readiness state.
 * A build for any other revision (or a legacy one) is never shown as ready or
 * failed for the current code: it reads as "needs a new build" (pending).
 */
export const STALE_BUILD_LABEL = "Your latest changes need a new build";
export function revisionAwareBuildSnapshot<
  T extends { status: string; projectRevision: number | null; verification: unknown; errorMessage: string | null; progressLabel: string | null },
>(snap: T | null, projectRevision: number | string | null | undefined): T | null {
  if (!snap) return null;
  if (projectRevision === null || projectRevision === undefined) return snap;
  if (buildRevisionStatus({ project_revision: snap.projectRevision }, { revision: projectRevision }).current) return snap;
  return { ...snap, status: "pending", verification: null, errorMessage: null, progressLabel: STALE_BUILD_LABEL };
}

/** Project revision is monotonic: never let an older payload lower it. */
export function newerRevision(prev: number | null | undefined, next: number | null | undefined): number | null {
  if (next === null || next === undefined) return prev ?? null;
  if (prev === null || prev === undefined) return next;
  return Math.max(Number(prev), Number(next));
}
