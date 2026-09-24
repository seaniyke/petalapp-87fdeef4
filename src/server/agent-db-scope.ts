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
type Scope = "project_id" | "id" | "turn_id";

export const TABLE_RULES: Record<string, { scope: Scope; actions: Action[]; userCol?: boolean }> = {
  project_files: { scope: "project_id", actions: ["select"] },
  project_memory: { scope: "project_id", actions: ["select", "insert", "upsert", "update", "delete"] },
  project_blueprints: { scope: "project_id", actions: ["select", "upsert", "update"] },
  project_pictures: { scope: "project_id", actions: ["select", "insert"] },
  project_intelligence: { scope: "project_id", actions: ["select", "insert", "upsert", "update"] },
  project_integrations: { scope: "project_id", actions: ["select"] },
  project_backends: { scope: "project_id", actions: ["select"] },
  projects: { scope: "id", actions: ["select"] },
  ai_call_log: { scope: "turn_id", actions: ["select", "update"] },
  pipeline_failures: { scope: "project_id", actions: ["insert"], userCol: true },
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

export type ScopedQuery = Omit<DbQuery, "op"> & { scopeCol: Scope; scopeValue: string };

/** Validate and pin a query to the turn. Returns an error code on refusal. */
export function scopeDbQuery(q: DbQuery, ids: ScopeIds): ScopedQuery | { error: string } {
  const rule = TABLE_RULES[q.table];
  if (!rule) return { error: "table_not_allowed" };
  if (!rule.actions.includes(q.action)) return { error: "action_not_allowed" };
  const scopeValue = rule.scope === "turn_id" ? ids.turnId : ids.projectId;
  // Caller may not filter or write the scope column to anything else.
  for (const f of q.filters) {
    if (f.col === rule.scope && !(f.op === "eq" && f.value === scopeValue)) return { error: "scope_violation" };
  }
  const pin = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...row, [rule.scope]: scopeValue };
    if (rule.userCol) out.user_id = ids.userId;
    return out;
  };
  let values = q.values;
  if (q.action === "insert" || q.action === "upsert") {
    if (!values) return { error: "values_required" };
    values = Array.isArray(values) ? values.map(pin) : pin(values);
  } else if (q.action === "update") {
    if (!values || Array.isArray(values)) return { error: "values_required" };
    const { [rule.scope]: _drop, ...rest } = values;
    values = rest;
  }
  const { op: _op, ...rest } = q;
  return { ...rest, values, scopeCol: rule.scope, scopeValue };
}
