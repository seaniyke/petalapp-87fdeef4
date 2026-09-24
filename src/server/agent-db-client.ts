/**
 * Stand-in database client for generation running on Railway.
 *
 * Mimics the subset of the query-builder API the generation helpers use
 * (`from().select/insert/upsert/update/delete().eq/in/is/...order/limit/
 * single/maybeSingle`) and turns each chain into one `db.query` op for the
 * signed gateway. The gateway enforces table, action and project scope, so
 * this client grants nothing by itself. Unsupported calls throw loudly.
 */
import type { DbQuery } from "@/server/agent-db-scope";

export type SendDbQuery = (q: DbQuery) => Promise<{ data: unknown; error: { message: string } | null }>;

type Result = { data: unknown; error: { message: string } | null };

class Builder implements PromiseLike<Result> {
  private q: DbQuery;
  constructor(private send: SendDbQuery, table: string) {
    this.q = { op: "db.query", table, action: "select", filters: [] };
  }
  select(columns?: string) {
    if (this.q.action === "select") this.q.columns = columns;
    else {
      this.q.returning = true;
      this.q.columns = columns;
    }
    return this;
  }
  insert(values: DbQuery["values"]) { return this.set("insert", values); }
  upsert(values: DbQuery["values"], opts?: { onConflict?: string }) {
    this.q.onConflict = opts?.onConflict;
    return this.set("upsert", values);
  }
  update(values: DbQuery["values"]) { return this.set("update", values); }
  delete() { this.q.action = "delete"; return this; }
  private set(action: DbQuery["action"], values: DbQuery["values"]) {
    this.q.action = action;
    this.q.values = values;
    return this;
  }
  private f(op: DbQuery["filters"][number]["op"], col: string, value: unknown) {
    this.q.filters.push({ col, op, value });
    return this;
  }
  eq(c: string, v: unknown) { return this.f("eq", c, v); }
  neq(c: string, v: unknown) { return this.f("neq", c, v); }
  in(c: string, v: unknown[]) { return this.f("in", c, v); }
  is(c: string, v: unknown) { return this.f("is", c, v); }
  gte(c: string, v: unknown) { return this.f("gte", c, v); }
  lte(c: string, v: unknown) { return this.f("lte", c, v); }
  gt(c: string, v: unknown) { return this.f("gt", c, v); }
  lt(c: string, v: unknown) { return this.f("lt", c, v); }
  not(c: string, op: string, v: unknown) {
    if (op !== "is") throw new Error(`agent-db-client: not(${op}) unsupported`);
    return this.f("not_is", c, v);
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.q.order = { col, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) { this.q.limit = n; return this; }
  single() { this.q.single = "single"; return this; }
  maybeSingle() { this.q.single = "maybeSingle"; return this; }
  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.send(this.q).then(ok, bad);
  }
}

export function createAgentDbClient(send: SendDbQuery) {
  return { from: (table: string) => new Builder(send, table) };
}
