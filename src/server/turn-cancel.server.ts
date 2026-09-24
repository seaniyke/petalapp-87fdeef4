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

type TurnRowLite = { id: string; user_id: string; status: string; committed_at: string | null };

/** What the owner should be told, derived only from the durable row. */
function outcomeOf(row: Pick<TurnRowLite, "status" | "committed_at">): CancelResult {
  if (row.status === "aborted") return { ok: true, cancelled: true, status: "aborted" };
  // Past the commit point the turn is finishing; Stop can no longer win.
  if (row.status === "running" && row.committed_at) return { ok: true, cancelled: false, status: "completing" };
  return { ok: true, cancelled: false, status: row.status };
}

/**
 * Idempotent, owner-scoped cancel. Stop wins ONLY on a row that is still
 * `running` AND has not passed the commit point (`committed_at` null). The
 * pipeline claims that point with the mirror-image conditional update
 * (`claimTurnCommit`), so exactly one of the two can ever succeed.
 */
export async function requestTurnCancel(
  turnId: string,
  userId: string,
  client: Admin | null = admin(),
): Promise<CancelResult> {
  if (!client) return { ok: false, code: 500 };
  const { data: row, error } = await client
    .from("turns")
    .select("id,user_id,status,committed_at")
    .eq("id", turnId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, code: 500 };
  if (!row) return { ok: false, code: 404 };
  const r = row as unknown as TurnRowLite;
  if (r.status !== "running" || r.committed_at) {
    if (r.status === "aborted") abortLocalTurn(turnId);
    return outcomeOf(r);
  }
  const { data: updated } = await client
    .from("turns")
    .update({ status: "aborted", ended_at: new Date().toISOString(), error_message: CANCEL_REASON })
    .eq("id", turnId)
    .eq("user_id", userId)
    .eq("status", "running")
    .is("committed_at", null)
    .select("id");
  if (updated && updated.length > 0) {
    abortLocalTurn(turnId);
    // Durable jobs run on the builder: stop its run of this turn at once.
    // Only reached when Stop won (uncommitted), so nothing is mid-charge.
    await import("@/server/durable-agent.server")
      .then((m) => m.cancelAgentJob(turnId))
      .catch(() => {});
    return { ok: true, cancelled: true, status: "aborted" };
  }
  // Lost the race (turn committed or finished) — report its real state and
  // leave its work controller alone.
  const { data: after } = await client
    .from("turns")
    .select("status,committed_at")
    .eq("id", turnId)
    .maybeSingle();
  return after ? outcomeOf(after as unknown as TurnRowLite) : { ok: true, cancelled: false, status: "unknown" };
}

/**
 * The commit point, taken immediately before billing → saving files. Atomic
 * mirror of `requestTurnCancel`: succeeds only while the row is `running` and
 * uncommitted. After it succeeds Stop can no longer win; if it fails because
 * the turn was aborted, the pipeline throws into its user-cancel branch and
 * nothing is charged, saved or built. A missing row (turn tracking disabled)
 * never blocks a build.
 */
export async function claimTurnCommit(
  turnId: string | undefined,
  signal: AbortSignal | undefined,
  client: Admin | null = admin(),
): Promise<void> {
  if (signal?.aborted) throw new Error("Stopped by user before saving");
  if (!turnId || !client) return;
  const { data: claimed, error } = await client
    .from("turns")
    .update({ committed_at: new Date().toISOString() })
    .eq("id", turnId)
    .eq("status", "running")
    .is("committed_at", null)
    .select("id");
  if (!error && claimed && claimed.length > 0) return;
  const { data: row } = await client.from("turns").select("status,committed_at").eq("id", turnId).maybeSingle();
  if ((row as { status?: string } | null)?.status === "aborted") {
    abortLocalTurn(turnId);
    throw new Error("Stopped by user before saving");
  }
  // Row missing / already committed by an earlier pass / lookup error: the
  // user did not stop this turn, so the build proceeds.
}

/**
 * Silent-retry gate. A queued resume must not restart a turn the user
 * stopped. `failed` and `succeeded` are the states silent resume and repair
 * rounds exist to continue (an interrupted turn closes as failed; a repair
 * follows a finished build), so only an explicit Stop blocks it.
 */
export function turnAllowsResume(status: string | null | undefined): boolean {
  return status !== "aborted";
}

export async function turnStatusOf(turnId: string, client: Admin | null = admin()): Promise<string | null> {
  if (!client) return null;
  try {
    const { data } = await client.from("turns").select("status").eq("id", turnId).maybeSingle();
    return (data as { status?: string } | null)?.status ?? null;
  } catch {
    return null;
  }
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
