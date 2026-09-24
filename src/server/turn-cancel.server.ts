/**
 * User Stop → backend cancellation, keyed on the existing turn id.
 *
 * Two parts, no new infrastructure:
 *   1. The `turns` row is the durable signal. A Stop flips a RUNNING row to
 *      `aborted` (never a finished one), scoped to the owner.
 *   2. The detached `workController` of the running turn is registered here
 *      by turn id, so a Stop that lands in the same worker aborts it at once.
 *      A Stop that lands in another worker is picked up by
 *      `isTurnCancelled()` at the pipeline's boundaries (before page writes,
 *      images and billing) and on the existing status heartbeat.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

const controllers = new Map<string, AbortController>();

export function registerTurnController(turnId: string, controller: AbortController): () => void {
  controllers.set(turnId, controller);
  return () => {
    if (controllers.get(turnId) === controller) controllers.delete(turnId);
  };
}

/** Abort the local work controller for exactly this turn, if it lives here. */
export function abortLocalTurn(turnId: string): boolean {
  const c = controllers.get(turnId);
  if (!c) return false;
  if (!c.signal.aborted) c.abort(new Error("cancelled_by_user"));
  return true;
}

let cached: Admin | null = null;
function admin(): Admin | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export const CANCEL_REASON = "cancelled_by_user";

export type CancelResult =
  | { ok: true; cancelled: true; status: "aborted" }
  | { ok: true; cancelled: false; status: string }
  | { ok: false; code: 404 | 500 };

/**
 * Idempotent, owner-scoped cancel. Only a `running` row changes; a finished,
 * already-aborted or someone else's turn is never touched.
 */
export async function requestTurnCancel(
  turnId: string,
  userId: string,
  client: Admin | null = admin(),
): Promise<CancelResult> {
  if (!client) return { ok: false, code: 500 };
  const { data: row, error } = await client
    .from("turns")
    .select("id,user_id,status")
    .eq("id", turnId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, code: 500 };
  if (!row) return { ok: false, code: 404 };
  if (row.status === "aborted") {
    abortLocalTurn(turnId);
    return { ok: true, cancelled: true, status: "aborted" };
  }
  if (row.status !== "running") return { ok: true, cancelled: false, status: row.status };
  const { data: updated } = await client
    .from("turns")
    .update({ status: "aborted", ended_at: new Date().toISOString(), error_message: CANCEL_REASON })
    .eq("id", turnId)
    .eq("user_id", userId)
    .eq("status", "running")
    .select("id");
  abortLocalTurn(turnId);
  if (updated && updated.length > 0) return { ok: true, cancelled: true, status: "aborted" };
  // Lost a race with the turn finishing on its own — report its real state.
  const { data: after } = await client.from("turns").select("status").eq("id", turnId).maybeSingle();
  const status = after?.status ?? "unknown";
  return status === "aborted"
    ? { ok: true, cancelled: true, status: "aborted" }
    : { ok: true, cancelled: false, status };
}

/** True when the durable row says this turn was stopped by its owner. */
export async function isTurnCancelled(turnId: string, client: Admin | null = admin()): Promise<boolean> {
  if (!client) return false;
  try {
    const { data } = await client.from("turns").select("status").eq("id", turnId).maybeSingle();
    return data?.status === "aborted";
  } catch {
    return false;
  }
}

/**
 * Boundary check used inside the pipeline. If the turn was stopped (locally
 * or from another worker), abort its work controller and throw so the
 * pipeline's existing user-cancel branch ends the turn as `aborted`.
 */
export async function assertTurnActive(
  turnId: string | undefined,
  signal: AbortSignal | undefined,
  stage: string,
  check: (id: string) => Promise<boolean> = (id) => isTurnCancelled(id),
): Promise<void> {
  if (signal?.aborted) throw new Error(`Stopped by user before ${stage}`);
  if (!turnId) return;
  if (await check(turnId)) {
    abortLocalTurn(turnId);
    throw new Error(`Stopped by user before ${stage}`);
  }
}
