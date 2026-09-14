/**
 * Orchestrates the lifecycle of a Petal-managed Supabase project.
 *
 * Flow:
 *   1. provisionForProject(projectId): called right after a backend slot is
 *      paid for. Creates the Supabase project, polls until ACTIVE_HEALTHY,
 *      fetches keys, persists them in project_backends. Marks the row 'failed'
 *      with an error message on any irrecoverable error.
 *
 *   2. refreshStatus(projectId): cheap status poll the UI hits while waiting.
 *      If the row is already 'ready', returns immediately. Otherwise it asks
 *      the Mgmt API; if status is now ACTIVE_HEALTHY but we don't have keys
 *      yet, it fetches them and flips the row to 'ready'. Used both as a
 *      fallback (in case provisionForProject was interrupted) and to surface
 *      the "still warming up" state.
 *
 *   3. pauseForProject(projectId): pauses the underlying Supabase project
 *      when a slot expires.
 *
 *   4. restoreForProject(projectId): restores after a renewal.
 *
 * All functions are idempotent — safe to retry.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createProject as mgmtCreate,
  getProject as mgmtGet,
  getApiKeys as mgmtGetKeys,
  pauseProject as mgmtPause,
  restoreProject as mgmtRestore,
  deleteProject as mgmtDelete,
  runQuery as mgmtRunQuery,
  projectUrl,
} from "@/server/supabase-mgmt.server";

const READY_STATUS = "ACTIVE_HEALTHY";
const FATAL_STATUSES = new Set(["INIT_FAILED", "RESTORE_FAILED", "REMOVED"]);

/** Soft cap: provision wait time before we give up and let the UI poll. */
const MAX_INLINE_WAIT_MS = 4 * 60 * 1000; // 4 minutes
const POLL_INTERVAL_MS = 6_000;

function projectNameFor(projectId: string): string {
  // Supabase project names must be <= 60 chars; we use the Petal project id
  // (without dashes) so it's traceable from the dashboard.
  return `petal-${projectId.replace(/-/g, "").slice(0, 24)}`;
}

async function setBackend(
  projectId: string,
  patch: Partial<{
    status: string;
    supabase_url: string;
    anon_key: string;
    service_role_key: string | null;
    supabase_project_ref: string | null;
    error_message: string | null;
    pause_reason: string | null;
    delete_warned_at: string | null;
    paused_at: string | null;
    health_checked_at: string | null;
    provisioning_started_at: string | null;
  }>,
): Promise<void> {
  // service_role_key lives in a separate service-role-only table so it
  // can never be exposed through project_backends SELECT policies.
  const { service_role_key, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    const { error } = await supabaseAdmin
      .from("project_backends")
      .update(rest)
      .eq("project_id", projectId);
    if (error) throw new Error(`update project_backends: ${error.message}`);
  }
  if (service_role_key !== undefined) {
    const { error } = await supabaseAdmin
      .from("project_backend_secrets")
      .upsert(
        { project_id: projectId, service_role_key, updated_at: new Date().toISOString() },
        { onConflict: "project_id" },
      );
    if (error) throw new Error(`update project_backend_secrets: ${error.message}`);
  }
}


/**
 * Ensure the upstream Supabase project exists. AWAITED inline so the
 * `supabase_project_ref` is persisted before the HTTP response returns —
 * otherwise the Worker may kill our background promise and leave a wedged
 * row with no ref (unrecoverable by `refreshStatus`).
 *
 * Idempotent: re-uses an existing ref if present. On a hard failure, marks
 * the row 'failed' and rethrows so the caller can return a 502.
 */
export async function ensureUpstreamProjectRef(
  projectId: string,
): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from("project_backends")
    .select("status, supabase_project_ref, provider")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`No project_backends row for ${projectId}`);
  if (row.provider !== "managed_petal") {
    throw new Error(
      `project_backends.provider is ${row.provider}, not managed_petal — refusing to provision.`,
    );
  }
  if (row.supabase_project_ref) return row.supabase_project_ref;

  try {
    const created = await mgmtCreate({ name: projectNameFor(projectId) });
    await setBackend(projectId, {
      supabase_project_ref: created.ref,
      provisioning_started_at: new Date().toISOString(),
      error_message: null,
    });
    return created.ref;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[managed-backend] create failed", projectId, msg);
    await setBackend(projectId, {
      status: "failed",
      error_message: `Couldn't create Supabase project: ${msg.slice(0, 300)}`,
    });
    throw e;
  }
}

/**
 * Kicks off (or resumes) provisioning of a managed Supabase project.
 *
 * Two-phase:
 *   Phase A (awaited): ensure upstream project + ref persisted.
 *   Phase B (best-effort polling): walk the Mgmt API until ACTIVE_HEALTHY,
 *     then finalize keys. If the Worker kills us mid-poll, the UI's
 *     `refreshStatus` poll will pick up where we left off because the ref
 *     is already saved.
 */
export async function provisionForProject(projectId: string): Promise<void> {
  // Look up current state.
  const { data: row, error } = await supabaseAdmin
    .from("project_backends")
    .select("status, supabase_url, anon_key, supabase_project_ref, provider")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`No project_backends row for ${projectId}`);
  if (row.provider !== "managed_petal") {
    throw new Error(
      `project_backends.provider is ${row.provider}, not managed_petal — refusing to provision.`,
    );
  }
  if (row.status === "ready" && row.supabase_url && row.anon_key) {
    return; // already done
  }

  let ref: string | null = row.supabase_project_ref ?? null;
  if (!ref) {
    // Should be rare — caller (handleEnableManaged) already awaited
    // ensureUpstreamProjectRef. But this is the recovery path used by
    // refreshStatus when it finds a stalled row.
    try {
      ref = await ensureUpstreamProjectRef(projectId);
    } catch {
      return; // ensureUpstreamProjectRef already marked the row failed
    }
  }

  // Poll until ready (with cap).
  const deadline = Date.now() + MAX_INLINE_WAIT_MS;
  while (Date.now() < deadline) {
    let status: string | null = null;
    try {
      const proj = await mgmtGet(ref);
      status = proj?.status ?? null;
    } catch (e) {
      // Transient API errors — try again.
      console.warn("[managed-backend] poll error", ref, (e as Error).message);
    }
    if (status === READY_STATUS) {
      await finalizeReady(projectId, ref);
      return;
    }
    if (status && FATAL_STATUSES.has(status)) {
      await setBackend(projectId, {
        status: "failed",
        error_message: `Supabase project ${ref} is in state ${status}.`,
      });
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Hit the cap — leave row 'provisioning', UI will poll via refreshStatus.
}

/** Fetch keys + URL and flip the row to 'ready'. Idempotent. */
async function finalizeReady(projectId: string, ref: string): Promise<void> {
  let keys: { anonKey: string; serviceRoleKey: string | null };
  try {
    keys = await mgmtGetKeys(ref);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setBackend(projectId, {
      status: "failed",
      error_message: `Couldn't fetch API keys: ${msg.slice(0, 300)}`,
    });
    return;
  }
  await setBackend(projectId, {
    status: "ready",
    supabase_url: projectUrl(ref),
    anon_key: keys.anonKey,
    service_role_key: keys.serviceRoleKey,
    paused_at: null,
    health_checked_at: new Date().toISOString(),
    error_message: null,
  });
}

/**
 * Cheap status check used by the UI poll. Returns the current row plus a
 * derived "phase" the client can render. If the project has finished
 * provisioning since last we looked, finalizes credentials in-place.
 */
export async function refreshStatus(projectId: string): Promise<{
  status: "provisioning" | "ready" | "paused" | "failed" | "missing";
  errorMessage: string | null;
  supabaseUrl: string | null;
  supabaseProjectRef: string | null;
  upstreamStatus: string | null;
}> {
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select(
      "status, supabase_url, anon_key, supabase_project_ref, error_message, provider, provisioning_started_at",
    )
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row || row.provider !== "managed_petal") {
    return {
      status: "missing",
      errorMessage: null,
      supabaseUrl: null,
      supabaseProjectRef: null,
      upstreamStatus: null,
    };
  }

  // If we already have everything, just report ready.
  if (row.status === "ready" && row.supabase_url && row.anon_key) {
    return {
      status: "ready",
      errorMessage: null,
      supabaseUrl: row.supabase_url,
      supabaseProjectRef: row.supabase_project_ref,
      upstreamStatus: READY_STATUS,
    };
  }
  if (row.status === "failed") {
    return {
      status: "failed",
      errorMessage: row.error_message,
      supabaseUrl: row.supabase_url || null,
      supabaseProjectRef: row.supabase_project_ref,
      upstreamStatus: null,
    };
  }
  if (row.status === "paused") {
    return {
      status: "paused",
      errorMessage: row.error_message,
      supabaseUrl: row.supabase_url || null,
      supabaseProjectRef: row.supabase_project_ref,
      upstreamStatus: null,
    };
  }

  // Provisioning. Self-heal stalled rows (no upstream ref after 30s of waiting):
  // either the original Worker died before persisting the ref, or the Mgmt API
  // call silently failed. Re-attempt the create and kick the polling.
  if (!row.supabase_project_ref) {
    const startedMs = row.provisioning_started_at
      ? new Date(row.provisioning_started_at).getTime()
      : 0;
    const ageMs = Date.now() - startedMs;
    if (!startedMs || ageMs > 30_000) {
      try {
        await ensureUpstreamProjectRef(projectId);
        // Fire-and-forget poll. Next refreshStatus tick will pick up upstream.
        provisionForProject(projectId).catch((e) =>
          console.error("[refreshStatus] heal-provision failed", e),
        );
      } catch (e) {
        // ensureUpstreamProjectRef already marked the row failed.
        const msg = e instanceof Error ? e.message : String(e);
        return {
          status: "failed",
          errorMessage: `Couldn't create Supabase project: ${msg.slice(0, 300)}`,
          supabaseUrl: null,
          supabaseProjectRef: null,
          upstreamStatus: null,
        };
      }
    }
    return {
      status: "provisioning",
      errorMessage: null,
      supabaseUrl: null,
      supabaseProjectRef: null,
      upstreamStatus: null,
    };
  }

  // Have a ref — peek at upstream status.
  let upstream: string | null = null;
  try {
    const proj = await mgmtGet(row.supabase_project_ref);
    upstream = proj?.status ?? null;
    if (upstream === READY_STATUS) {
      await finalizeReady(projectId, row.supabase_project_ref);
      return {
        status: "ready",
        errorMessage: null,
        supabaseUrl: projectUrl(row.supabase_project_ref),
        supabaseProjectRef: row.supabase_project_ref,
        upstreamStatus: upstream,
      };
    }
    if (upstream && FATAL_STATUSES.has(upstream)) {
      await setBackend(projectId, {
        status: "failed",
        error_message: `Supabase project is in state ${upstream}.`,
      });
      return {
        status: "failed",
        errorMessage: `Supabase project is in state ${upstream}.`,
        supabaseUrl: null,
        supabaseProjectRef: row.supabase_project_ref,
        upstreamStatus: upstream,
      };
    }
  } catch (e) {
    console.warn("[managed-backend] refreshStatus mgmt err", (e as Error).message);
  }

  return {
    status: "provisioning",
    errorMessage: null,
    supabaseUrl: null,
    supabaseProjectRef: row.supabase_project_ref,
    upstreamStatus: upstream,
  };
}

/**
 * Why a dedicated database was paused. "idle" means nobody used the app;
 * "unpaid" means the owner ran out of credits through the grace window.
 * The reason decides both the message the user sees and whether opening the
 * app is allowed to wake it back up automatically.
 */
export type PauseReason = "idle" | "unpaid" | "expired";

const PAUSE_MESSAGES: Record<PauseReason, string> = {
  idle: "Paused because the app went unused for 7 days. It wakes up automatically when you open it.",
  unpaid: "Paused because you ran out of credits. Top up to bring it back online.",
  expired: "Backend slot expired — renew to reactivate.",
};

export async function pauseForProject(
  projectId: string,
  reason: PauseReason = "expired",
): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select("supabase_project_ref, provider")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row || row.provider !== "managed_petal" || !row.supabase_project_ref) return;
  try {
    await mgmtPause(row.supabase_project_ref);
  } catch (e) {
    console.warn("[managed-backend] pause failed", (e as Error).message);
  }
  await setBackend(projectId, {
    status: "paused",
    paused_at: new Date().toISOString(),
    pause_reason: reason,
    error_message: PAUSE_MESSAGES[reason],
  });
}

export async function restoreForProject(projectId: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select("supabase_project_ref, provider, status")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row || row.provider !== "managed_petal" || !row.supabase_project_ref) return;
  if (row.status !== "paused") return;
  try {
    await mgmtRestore(row.supabase_project_ref);
  } catch (e) {
    console.warn("[managed-backend] restore failed", (e as Error).message);
  }
  await setBackend(projectId, {
    status: "provisioning",
    paused_at: null,
    pause_reason: null,
    delete_warned_at: null,
    error_message: null,
  });
}

/**
 * How many dedicated Supabase projects we currently keep alive. Used as a
 * ceiling before provisioning another one — every live project costs money
 * whether or not the app behind it is being used.
 */
export async function activeManagedCount(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("project_backends")
    .select("project_id", { count: "exact", head: true })
    .eq("provider", "managed_petal")
    .in("status", ["provisioning", "ready"]);
  return count ?? 0;
}

/**
 * Dump every row of a managed project's public tables into a JSON file stored
 * in the Petal project's own files, so deleting the upstream database never
 * loses the user's data outright. Best-effort and size-capped.
 */
export async function exportManagedData(projectId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select("supabase_project_ref, provider, status")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row?.supabase_project_ref || row.provider !== "managed_petal") return null;
  if (row.status !== "ready") return null; // a paused project can't answer queries

  try {
    const tables = (await mgmtRunQuery(
      row.supabase_project_ref,
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    )) as { table_name: string }[];

    const dump: Record<string, unknown[]> = {};
    for (const t of tables.slice(0, 50)) {
      const name = String(t.table_name).replace(/[^a-zA-Z0-9_]/g, "");
      if (!name) continue;
      try {
        dump[name] = await mgmtRunQuery(
          row.supabase_project_ref,
          `select * from public."${name}" limit 5000`,
        );
      } catch {
        dump[name] = [];
      }
    }

    const path = `backups/backend-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), tables: dump }, null, 2);
    if (content.length > 4_000_000) return null;
    await supabaseAdmin
      .from("project_files")
      .upsert({ project_id: projectId, path, content }, { onConflict: "project_id,path" });
    return path;
  } catch (e) {
    console.warn("[managed-backend] export failed", projectId, (e as Error).message);
    return null;
  }
}

/**
 * Permanently remove the upstream Supabase project and Petal's record of it.
 * Exports the data first unless the caller opts out. Idempotent.
 */
export async function deleteForProject(
  projectId: string,
  opts: { exportFirst?: boolean } = {},
): Promise<{ deletedRef: string | null; backupPath: string | null }> {
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select("supabase_project_ref, provider")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row || row.provider !== "managed_petal") {
    return { deletedRef: null, backupPath: null };
  }

  let backupPath: string | null = null;
  if (opts.exportFirst !== false) {
    backupPath = await exportManagedData(projectId);
  }

  if (row.supabase_project_ref) {
    try {
      await mgmtDelete(row.supabase_project_ref);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      // A 404 means it is already gone upstream — that is success for us.
      if (!/404|not found/i.test(msg)) throw e;
    }
  }

  await supabaseAdmin.from("project_backend_secrets").delete().eq("project_id", projectId);
  await supabaseAdmin.from("project_backends").delete().eq("project_id", projectId);
  await supabaseAdmin
    .from("projects")
    .update({ backend_type: "shared", runtime_grace_until: null, runtime_paused: false })
    .eq("id", projectId);

  return { deletedRef: row.supabase_project_ref ?? null, backupPath };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
