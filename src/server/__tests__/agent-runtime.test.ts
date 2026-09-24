import { describe, it, expect } from "vitest";
import { createGatewayAgentIO, createGatewayDb, createOpsSender, type SendOps } from "@/server/agent-runtime/gateway";
import { scopeDbRpc } from "@/server/agent-db-scope";
import type { AgentOp, OpResult } from "@/server/agent-ops.server";

function fake(reply: (op: AgentOp) => OpResult) {
  const sent: AgentOp[] = [];
  const send: SendOps = async (ops) => ops.map((o) => (sent.push(o), reply(o)));
  return { send, sent };
}

describe("Railway runtime gateway adapter", () => {
  it("Stop wins at the commit point", async () => {
    const f = fake((o) => (o.op === "turn.claimCommit" ? { ok: false, error: "commit_lost" } : { ok: true, data: { status: "aborted" } }));
    await expect(createGatewayAgentIO(f.send).claimCommit("t", undefined)).rejects.toThrow("Stopped by user before saving");
  });
  it("an earlier commit by the same turn lets the build proceed", async () => {
    const f = fake((o) => (o.op === "turn.claimCommit" ? { ok: false, error: "commit_lost" } : { ok: true, data: { status: "running" } }));
    await expect(createGatewayAgentIO(f.send).claimCommit("t", undefined)).resolves.toBeUndefined();
  });
  it("assertActive throws after Stop and never calls the gateway when already aborted locally", async () => {
    const f = fake(() => ({ ok: true, data: { status: "aborted" } }));
    const io = createGatewayAgentIO(f.send);
    await expect(io.assertActive("t", undefined, "pictures")).rejects.toThrow("Stopped by user before pictures");
    const ac = new AbortController();
    ac.abort();
    const n = f.sent.length;
    await expect(io.assertActive("t", ac.signal, "billing")).rejects.toThrow();
    expect(f.sent.length).toBe(n);
  });
  it("settlement failure is thrown, not swallowed", async () => {
    const f = fake(() => ({ ok: false, error: "commit_not_claimed" }));
    await expect(
      createGatewayAgentIO(f.send).settleCharge({ userId: "u", amount: 1, projectId: "p", turnId: "t", metadata: {} }),
    ).rejects.toThrow("commit_not_claimed");
  });
  it("stand-in database surfaces gateway refusals as errors", async () => {
    const f = fake(() => ({ ok: false, error: "table_not_allowed" }));
    const db = createGatewayDb(f.send);
    const r = await db.from("user_wallets").select("*");
    expect(r.error?.message).toBe("table_not_allowed");
    const rr = await db.rpc("spend_credit", {});
    expect(rr.error?.message).toBe("table_not_allowed");
  });
  it("signs every gateway request", async () => {
    const calls: RequestInit[] = [];
    const send = createOpsSender({
      appOrigin: "https://app.example",
      secret: "s",
      turnId: "11111111-1111-1111-1111-111111111111",
      fetcher: (async (_u: unknown, init: RequestInit) => (calls.push(init), new Response(JSON.stringify({ results: [{ ok: true }] })))) as never,
    });
    await send([{ op: "turn.status" }]);
    const h = calls[0].headers as Record<string, string>;
    expect(h["x-petal-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h["x-petal-timestamp"]).toMatch(/^\d+$/);
  });
});

describe("database function allow-list", () => {
  const ids = { projectId: "p1", userId: "u1", turnId: "t1" };
  it("pins the user argument", () => {
    expect(scopeDbRpc({ op: "db.rpc", fn: "is_paid_plan", args: { _user_id: "someone-else" } }, ids)).toEqual({ fn: "is_paid_plan", args: { _user_id: "u1" } });
  });
  it("refuses functions that move money", () => {
    expect(scopeDbRpc({ op: "db.rpc", fn: "spend_credit", args: {} }, ids)).toEqual({ error: "rpc_not_allowed" });
  });
});
