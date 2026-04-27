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
    paused_at: string | null;
    health_checked_at: string | null;
    provisioning_started_at: string | null;
  }>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("project_backends")
    .update(patch)
    .eq("project_id", projectId);
  if (error) throw new Error(`update project_backends: ${error.message}`);
}

/**
 * Kicks off (or resumes) provisioning of a managed Supabase project. Should
 * be invoked right after apply_paystack_backend_slot inserts the slot row.
 *
 * Returns when the project is ACTIVE_HEALTHY (and project_backends.status is
 * 'ready'), OR after MAX_INLINE_WAIT_MS — in which case the row is left as
 * 'provisioning' and the UI poll will pick it up.
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

  // Step 1: ensure a Supabase project exists. If we already have a ref,
  // reuse it; otherwise create one.
  let ref: string | null = row.supabase_project_ref ?? null;
  if (!ref) {
    try {
      const created = await mgmtCreate({ name: projectNameFor(projectId) });
      ref = created.ref;
      await setBackend(projectId, {
        supabase_project_ref: ref,
        provisioning_started_at: new Date().toISOString(),
        error_message: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[managed-backend] create failed", projectId, msg);
      await setBackend(projectId, {
        status: "failed",
        error_message: `Couldn't create Supabase project: ${msg.slice(0, 300)}`,
      });
      return;
    }
  }

  // Step 2: poll until ready (with cap).
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
      "status, supabase_url, anon_key, supabase_project_ref, error_message, provider",
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

  // Otherwise we're provisioning — peek at upstream status.
  let upstream: string | null = null;
  if (row.supabase_project_ref) {
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
  }

  return {
    status: "provisioning",
    errorMessage: null,
    supabaseUrl: null,
    supabaseProjectRef: row.supabase_project_ref,
    upstreamStatus: upstream,
  };
}

export async function pauseForProject(projectId: string): Promise<void> {
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
    error_message: "Backend slot expired — renew to reactivate.",
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
    error_message: null,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
