/**
 * Managed-backend migration runner.
 *
 * Executes any `supabase/migrations/*.sql` files emitted into a project's
 * `project_files` against that project's managed Supabase Postgres, via the
 * Mgmt API "Run query" endpoint. Tracks history in
 * `project_backend_migrations` so re-runs are safe (idempotent on path +
 * content hash).
 *
 * Failure model: append-only. The first failed migration stops the run and
 * blocks later ones until the user (or the model) emits a new migration with
 * a later timestamped filename to fix it.
 *
 * Server-only. Never import from client code.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runQuery } from "@/server/supabase-mgmt.server";

export type MigrationOutcome = {
  applied: { path: string }[];
  skipped: { path: string; reason: "already-applied" }[];
  failed: { path: string; error: string } | null;
  /** True when the project has a ready managed backend; false means we no-op'd. */
  ran: boolean;
};

const MIGRATION_PATH_RE = /^supabase\/migrations\/[^/]+\.sql$/i;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Apply any pending migrations for `projectId`. Safe to call after every
 * generate turn — does nothing when there's no managed backend yet, and
 * skips migrations whose (path, content_hash) is already on file.
 */
export async function applyPendingMigrations(
  projectId: string,
): Promise<MigrationOutcome> {
  const empty: MigrationOutcome = {
    applied: [],
    skipped: [],
    failed: null,
    ran: false,
  };

  // 1. Look up the managed backend. Bail quietly if not provisioned/ready.
  const { data: backend } = await supabaseAdmin
    .from("project_backends")
    .select("provider, status, supabase_project_ref")
    .eq("project_id", projectId)
    .maybeSingle();

  if (
    !backend ||
    backend.provider !== "managed_petal" ||
    backend.status !== "ready" ||
    !backend.supabase_project_ref
  ) {
    return empty;
  }

  const ref = backend.supabase_project_ref;

  // 2. Load all migration files for the project, sorted by path (filenames
  //    are timestamp-prefixed so lexical sort = chronological).
  const { data: files, error: filesErr } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);

  if (filesErr || !files) return { ...empty, ran: true };

  const migrations = files
    .filter((f) => typeof f.path === "string" && MIGRATION_PATH_RE.test(f.path))
    .map((f) => ({
      path: f.path as string,
      content: (f.content as string) ?? "",
      hash: sha256((f.content as string) ?? ""),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (migrations.length === 0) return { ...empty, ran: true };

  // 3. Diff against history. A migration is pending if no row matches both
  //    (path, content_hash) — that is, either we've never seen this path,
  //    or its content has changed since we last applied it.
  const { data: history } = await supabaseAdmin
    .from("project_backend_migrations")
    .select("migration_path, content_hash, applied_status")
    .eq("project_id", projectId);

  const successKeys = new Set(
    (history ?? [])
      .filter((r) => r.applied_status === "success")
      .map((r) => `${r.migration_path}::${r.content_hash}`),
  );
  // If a migration previously failed at the same hash, also skip — the user
  // needs to fix it (emit a new migration with a later timestamp).
  const failedKeys = new Set(
    (history ?? [])
      .filter((r) => r.applied_status === "failed")
      .map((r) => `${r.migration_path}::${r.content_hash}`),
  );

  const applied: MigrationOutcome["applied"] = [];
  const skipped: MigrationOutcome["skipped"] = [];
  let failed: MigrationOutcome["failed"] = null;

  for (const m of migrations) {
    const key = `${m.path}::${m.hash}`;
    if (successKeys.has(key)) {
      skipped.push({ path: m.path, reason: "already-applied" });
      continue;
    }
    if (failedKeys.has(key)) {
      // Same content failed before; don't keep retrying the same broken SQL.
      failed = {
        path: m.path,
        error: "Previously failed — emit a corrected migration to retry.",
      };
      break;
    }

    try {
      await runQuery(ref, m.content);
      await supabaseAdmin.from("project_backend_migrations").insert({
        project_id: projectId,
        migration_path: m.path,
        content_hash: m.hash,
        applied_status: "success",
      });
      applied.push({ path: m.path });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("project_backend_migrations").insert({
        project_id: projectId,
        migration_path: m.path,
        content_hash: m.hash,
        applied_status: "failed",
        error_message: errMsg,
      });
      failed = { path: m.path, error: errMsg };
      break; // stop on first failure
    }
  }

  return { applied, skipped, failed, ran: true };
}

/** Convenience for the Cloud panel "Migration history" list. */
export async function listMigrationHistory(
  projectId: string,
  limit = 20,
): Promise<
  {
    path: string;
    appliedAt: string;
    status: "success" | "failed";
    error: string | null;
  }[]
> {
  const { data } = await supabaseAdmin
    .from("project_backend_migrations")
    .select("migration_path, applied_at, applied_status, error_message")
    .eq("project_id", projectId)
    .order("applied_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => ({
    path: r.migration_path as string,
    appliedAt: r.applied_at as string,
    status: r.applied_status as "success" | "failed",
    error: (r.error_message as string | null) ?? null,
  }));
}
