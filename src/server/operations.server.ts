/**
 * Economic operations — the authoritative identity of one customer request.
 *
 * The database creates exactly one `economic_operations` row per turn (trigger
 * on `turns`), so the id is server-made and immutable. This module only
 * RESOLVES identity from an exact turn id; it never infers ownership from
 * "latest turn / latest charge / latest build" or timestamps. Missing identity
 * is reported as unknown, never guessed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export { toOperationType, creditPurposeFor } from "@/lib/operation-identity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BuildIdentity {
  operationId: string;
  turnId: string;
  attempt: number;
}

/** Exact build identity from the requesting turn, or null (attribution unknown). */
export async function resolveBuildIdentity(args: {
  turnId: string | null;
  projectId: string;
  userId: string;
}): Promise<BuildIdentity | null> {
  if (!args.turnId || !UUID.test(args.turnId)) return null;
  const { data: op } = await supabaseAdmin
    .from("economic_operations" as never)
    .select("id, project_id, user_id, build_attempts")
    .eq("turn_id", args.turnId)
    .maybeSingle();
  const row = op as { id: string; project_id: string; user_id: string; build_attempts: number } | null;
  // Fail closed: an operation from another project/user is never borrowed.
  if (!row || row.project_id !== args.projectId || row.user_id !== args.userId) return null;
  const attempt = Number(row.build_attempts ?? 0) + 1;
  await supabaseAdmin
    .from("economic_operations" as never)
    .update({ build_attempts: attempt, settlement_state: "BUILDING" } as never)
    .eq("id", row.id);
  return { operationId: row.id, turnId: args.turnId, attempt };
}

/** Build row identity, read from the build itself (set at creation). */
export async function buildOperation(buildId: string): Promise<{ operationId: string | null; turnId: string | null; revision: number | null }> {
  const { data } = await supabaseAdmin
    .from("project_builds")
    .select("operation_id, turn_id, project_revision")
    .eq("id", buildId)
    .maybeSingle();
  const r = data as { operation_id?: string | null; turn_id?: string | null; project_revision?: number | null } | null;
  return { operationId: r?.operation_id ?? null, turnId: r?.turn_id ?? null, revision: r?.project_revision ?? null };
}

/** Move an operation's settlement state. The DB refuses invalid moves (kept as-is). */
export async function advanceOperation(
  operationId: string,
  state: "BUILDING" | "VERIFYING" | "READY" | "FAILED" | "SETTLED",
  patch: Record<string, unknown> = {},
): Promise<void> {
  await supabaseAdmin
    .from("economic_operations" as never)
    .update({ settlement_state: state, ...patch } as never)
    .eq("id", operationId);
}
