/**
 * Shared retry path for builds the build service never picked up.
 *
 * Two callers:
 *  - `/api/builds/watchdog` — the open browser tab, after ~90s of silence.
 *  - `/api/public/cron/build-watchdog` — a server-side sweeper so a stalled
 *    build still self-heals when nobody is watching (tab closed, phone locked).
 *
 * Both share one claim (a compare-and-swap on `retry_count`), so a tab and the
 * cron can never double-post the same build to the builder.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postBuildToRailway } from "@/server/builder.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import {
  buildIntegrationEnvFiles,
  mergeFilesIntoPayload,
} from "@/server/integrations/env-injector.server";

export const MAX_BUILD_RETRIES = 4;
/** Quiet time, not age: a build that keeps reporting progress is never stuck,
 *  however long it runs. Only silence counts against it. */
export const MIN_STUCK_MS = 80_000;

export type RetryOutcome =
  | "not_found"
  | "not_active"
  | "not_stuck_yet"
  | "already_claimed"
  | "retried"
  | "failed"
  | "no_files"
  | "retry_failed"
  /** The project code moved on since this build: retrying would pack newer
   *  code under an older revision. Marked stale; the newer revision builds. */
  | "superseded";

export interface RetryResult {
  outcome: RetryOutcome;
  attempt?: number;
  error?: string;
  projectId?: string;
  ownerId?: string;
}

interface RetryOptions {
  /** When set, the build's project must be owned by this user. */
  requireOwnerId?: string;
  /** Minimum silence before a retry is allowed. */
  minStuckMs?: number;
  /** Log prefix so the two callers stay distinguishable in logs. */
  source?: string;
  /**
   * The caller itself changed project files for this rebuild (missing-package
   * fix). The rebuild is then a NEW code revision and the build is re-bound
   * to it. Without this, a retry only ever rebuilds its own revision.
   */
  adoptCurrentRevision?: boolean;
}

/**
 * Attempt exactly one retry of a stalled build. Safe to call repeatedly and
 * from several callers at once — the retry claim is atomic.
 */
export async function retryStalledBuild(
  buildId: string,
  opts: RetryOptions = {},
): Promise<RetryResult> {
  const source = opts.source ?? "watchdog";
  const minStuckMs = opts.minStuckMs ?? MIN_STUCK_MS;

  const { data: build } = await supabaseAdmin
    .from("project_builds")
    .select("id, project_id, status, retry_count, created_at, last_progress_at, project_revision")
    .eq("id", buildId)
    .maybeSingle();
  if (!build) return { outcome: "not_found" };
  if (build.status !== "pending" && build.status !== "building") {
    return { outcome: "not_active", projectId: build.project_id };
  }

  const quietSince = build.last_progress_at ?? build.created_at;
  if (Date.now() - new Date(quietSince).getTime() < minStuckMs) {
    return { outcome: "not_stuck_yet", projectId: build.project_id };
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id, hide_petal_badge")
    .eq("id", build.project_id)
    .maybeSingle();
  if (!project) return { outcome: "not_found" };
  if (opts.requireOwnerId && project.owner_id !== opts.requireOwnerId) {
    return { outcome: "not_found", projectId: build.project_id };
  }

  const currentRetry = build.retry_count ?? 0;

  // Retry budget exhausted — give up cleanly with a message the user can act on.
  if (currentRetry >= MAX_BUILD_RETRIES) {
    await supabaseAdmin
      .from("project_builds")
      .update({
        status: "failed",
        error_message:
          "The build service didn't respond after multiple attempts. Please try again in a moment.",
        ready_at: new Date().toISOString(),
      })
      .eq("id", buildId)
      .in("status", ["pending", "building"]);
    return { outcome: "failed", projectId: build.project_id, ownerId: project.owner_id };
  }

  // Compare-and-swap the retry counter so exactly one caller wins. We also push
  // `last_progress_at` forward: the retry itself is progress, and it keeps the
  // stalled-build reaper from killing the row while the retry is in flight.
  const nextRetry = currentRetry + 1;
  const now = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("project_builds")
    .update({ retry_count: nextRetry, last_retry_at: now, last_progress_at: now })
    .eq("id", buildId)
    .in("status", ["pending", "building"])
    .eq("retry_count", currentRetry)
    .select("id")
    .maybeSingle();
  if (!claimed) return { outcome: "already_claimed", projectId: build.project_id };

  // Revision identity: a retry rebuilds the SAME code revision. If the
  // project moved on, sending today's files under this build id would label
  // newer code with an older revision — refuse and mark the build stale.
  const { readFilesAtRevision } = await import("@/server/project-revision.server");
  const snap = await readFilesAtRevision(build.project_id);
  if (!snap.ok) return { outcome: "retry_failed", attempt: nextRetry, error: snap.error, projectId: build.project_id };
  if (opts.adoptCurrentRevision) {
    await supabaseAdmin.from("project_builds").update({ project_revision: snap.revision }).eq("id", buildId);
    console.info(`[revision] build=${buildId} re-bound to revision ${snap.revision} (${source})`);
  } else {
    const { buildRevisionStatus, staleReasonText } = await import("@/lib/build-revision");
    const rs = buildRevisionStatus(build, { revision: snap.revision });
    if (!rs.current) {
      const reason = staleReasonText(rs);
      await supabaseAdmin
        .from("project_builds")
        .update({
          status: "failed",
          stale_reason: reason,
          error_message: "Superseded by newer changes.",
          ready_at: new Date().toISOString(),
        })
        .eq("id", buildId)
        .in("status", ["pending", "building"]);
      console.info(`[revision] retry refused build=${buildId}: ${reason}`);
      return { outcome: "superseded", projectId: build.project_id, ownerId: project.owner_id };
    }
  }
  const files = snap.files.map((r) => ({ path: r.path, content: r.content }));
  if (files.length === 0) {
    await supabaseAdmin
      .from("project_builds")
      .update({
        status: "failed",
        error_message: "Project has no files to build.",
        ready_at: new Date().toISOString(),
      })
      .eq("id", buildId);
    return { outcome: "no_files", projectId: build.project_id };
  }

  const { data: backendRow } = await supabaseAdmin
    .from("project_backends")
    .select("supabase_url, anon_key")
    .eq("project_id", build.project_id)
    .maybeSingle();
  const backend = backendRow
    ? { url: backendRow.supabase_url, anonKey: backendRow.anon_key }
    : undefined;

  // A transport retry has no new write set. Re-send persisted files without
  // turning retry into another whole-project repair pass.
  console.info(
    `[cleanup-scope] turn=retry attempt=${nextRetry} unit=${source} written=0 modified=0 cleanup=0 duration_ms=0 result=skipped skipped=true paths=[] project=${build.project_id}`,
  );
  let withEnv = injectPreviewGuard(files, { projectId: build.project_id }).files;
  try {
    const envBundle = await buildIntegrationEnvFiles(build.project_id, withEnv);
    if (envBundle.files.length > 0) withEnv = mergeFilesIntoPayload(withEnv, envBundle.files);
  } catch (e) {
    console.warn(
      `[${source}] env injection failed for project=${build.project_id}:`,
      e instanceof Error ? e.message : String(e),
    );
  }

  const { shouldHideBadge } = await import("@/server/badge-access.server");
  const hideBadge = await shouldHideBadge(project.id, project.owner_id, project.hide_petal_badge);

  try {
    await postBuildToRailway({
      projectId: build.project_id,
      buildId,
      files: withEnv,
      hideBadge,
      cleanupPaths: [],
      cleanupMeta: { unitId: source },
    });
    console.log(`[${source}] retried build=${buildId} attempt=${nextRetry}`);
    return {
      outcome: "retried",
      attempt: nextRetry,
      projectId: build.project_id,
      ownerId: project.owner_id,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to reach builder";
    if (nextRetry >= MAX_BUILD_RETRIES) {
      await supabaseAdmin
        .from("project_builds")
        .update({
          status: "failed",
          error_message: `Could not reach build service after ${nextRetry} attempts: ${message}`,
          ready_at: new Date().toISOString(),
        })
        .eq("id", buildId);
    }
    return { outcome: "retry_failed", attempt: nextRetry, error: message, projectId: build.project_id };
  }
}

/**
 * Builds that have gone quiet and are eligible for a server-side retry.
 * Ordered oldest-quiet first so the most stuck build is rescued soonest.
 */
export async function listStalledBuilds(quietMs: number, limit: number) {
  const cutoff = new Date(Date.now() - quietMs).toISOString();
  const { data } = await supabaseAdmin
    .from("project_builds")
    .select("id, project_id, retry_count, created_at, last_progress_at, progress_label")
    .in("status", ["pending", "building"])
    .or(`last_progress_at.lt.${cutoff},and(last_progress_at.is.null,created_at.lt.${cutoff})`)
    .order("created_at", { ascending: true })
    .limit(limit);
  return data ?? [];
}
