/**
 * Scoped table access for generation running on Railway (Phase 2/3).
 *
 * Many helpers write through the shared database client. On Railway there is
 * no admin key, so those calls are served by a stand-in client that sends
 * each query to the signed gateway as a `db.query` op. This module holds the
 * SERVER-SIDE rules: which tables, which actions, and the scope column that
 * is always forced to the turn's own project/user/turn. Pure — no I/O.
 */
import { z } from "zod";

type Action = "select" | "insert" | "upsert" | "update" | "delete";
/** Which turn value is forced onto `col`. `null` = global read-only config. */
type Pin = { col: string; from: "project" | "user" | "turn" } | null;

export const TABLE_RULES: Record<string, { pin: Pin; actions: Action[]; userCol?: boolean }> = {
  project_files: { pin: { col: "project_id", from: "project" }, actions: ["select"] },
  project_memory: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert", "upsert", "update", "delete"] },
  project_blueprints: { pin: { col: "project_id", from: "project" }, actions: ["select", "upsert", "update"] },
  project_pictures: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert"] },
  project_intelligence: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert", "upsert", "update"] },
  project_integrations: { pin: { col: "project_id", from: "project" }, actions: ["select"] },
  project_backends: { pin: { col: "project_id", from: "project" }, actions: ["select"] },
  project_turn_completion: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert", "upsert", "update"], userCol: true },
  projects: { pin: { col: "id", from: "project" }, actions: ["select"] },
  // Terminal assistant reply for the turn (persistAbandonedTurnReply). Without
  // this, a Railway-run failed turn's reply was refused and vanished on reload.
  messages: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert"] },
  turns: { pin: { col: "id", from: "turn" }, actions: ["select"] },
  ai_call_log: { pin: { col: "turn_id", from: "turn" }, actions: ["select", "update"] },
  pipeline_failures: { pin: { col: "project_id", from: "project" }, actions: ["insert"], userCol: true },
  profiles: { pin: { col: "id", from: "user" }, actions: ["select"] },
  turn_economics: { pin: { col: "user_id", from: "user" }, actions: ["select"] },
  // Durable first-build checkpoints (saveShellCheckpoint / resume discard).
  // Without this every save from the build server was refused.
  build_checkpoints: { pin: { col: "project_id", from: "project" }, actions: ["select", "insert", "update"], userCol: true },
  ai_provider_settings: { pin: null, actions: ["select"] },
  economics_config: { pin: null, actions: ["select"] },
};

/** Read-only database functions a build may call; user/project args pinned. */
export const RPC_RULES: Record<string, { user?: string; project?: string; turn?: string }> = {
  // Merge finished pages into THIS turn's checkpoint only (_turn_id pinned).
  checkpoint_merge_pages: { turn: "_turn_id" },
  is_paid_plan: { user: "_user_id" },
  check_credit_balance: { user: "_user_id" },
  runtime_cap_check: { user: "_user_id", project: "_project_id" },
};

const Filter = z.object({
  col: z.string().regex(/^[a-z_][a-z0-9_]*(->>?[a-z0-9_]+)?$/i).max(80),
  op: z.enum(["eq", "neq", "in", "is", "gte", "lte", "gt", "lt", "not_is"]),
  value: z.unknown(),
});

export const DbQuerySchema = z.object({
  op: z.literal("db.query"),
  table: z.string().max(60),
  action: z.enum(["select", "insert", "upsert", "update", "delete"]),
  columns: z.string().max(500).optional(),
  filters: z.array(Filter).max(20).default([]),
  values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown())).max(200)]).optional(),
  onConflict: z.string().max(100).optional(),
  order: z.object({ col: z.string().max(80), ascending: z.boolean() }).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  returning: z.boolean().optional(),
  single: z.enum(["single", "maybeSingle"]).optional(),
});
export type DbQuery = z.infer<typeof DbQuerySchema>;

export type ScopeIds = { projectId: string; userId: string; turnId: string };

export type ScopedQuery = Omit<DbQuery, "op"> & { scopeCol: string | null; scopeValue: string | null };

export const DbRpcSchema = z.object({
  op: z.literal("db.rpc"),
  fn: z.string().max(60),
  args: z.record(z.unknown()).default({}),
});
export type DbRpc = z.infer<typeof DbRpcSchema>;

export function scopeDbRpc(q: DbRpc, ids: ScopeIds): { fn: string; args: Record<string, unknown> } | { error: string } {
  const rule = RPC_RULES[q.fn];
  if (!rule) return { error: "rpc_not_allowed" };
  const args = { ...q.args };
  if (rule.user) args[rule.user] = ids.userId;
  if (rule.project && args[rule.project] != null) args[rule.project] = ids.projectId;
  if (rule.turn) args[rule.turn] = ids.turnId;
  return { fn: q.fn, args };
}

/** Validate and pin a query to the turn. Returns an error code on refusal. */
export function scopeDbQuery(q: DbQuery, ids: ScopeIds): ScopedQuery | { error: string } {
  const rule = TABLE_RULES[q.table];
  if (!rule) return { error: "table_not_allowed" };
  if (!rule.actions.includes(q.action)) return { error: "action_not_allowed" };
  const pin = rule.pin;
  const scopeValue = !pin ? null : pin.from === "turn" ? ids.turnId : pin.from === "user" ? ids.userId : ids.projectId;
  if (pin) {
    for (const f of q.filters) {
      if (f.col === pin.col && !(f.op === "eq" && f.value === scopeValue)) return { error: "scope_violation" };
    }
  }
  const stamp = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...row };
    if (pin) out[pin.col] = scopeValue;
    if (rule.userCol) out.user_id = ids.userId;
    return out;
  };
  let values = q.values;
  if (q.action === "insert" || q.action === "upsert") {
    if (!values) return { error: "values_required" };
    values = Array.isArray(values) ? values.map(stamp) : stamp(values);
  } else if (q.action === "update") {
    if (!values || Array.isArray(values)) return { error: "values_required" };
    const rest = { ...values };
    if (pin) delete rest[pin.col];
    if (rule.userCol) delete rest.user_id;
    values = rest;
  }
  const { op: _op, ...rest } = q;
  return { ...rest, values, scopeCol: pin?.col ?? null, scopeValue };
}
