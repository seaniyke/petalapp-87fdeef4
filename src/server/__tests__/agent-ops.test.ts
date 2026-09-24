import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "@/server/builder.server";
import {
  AgentOpError,
  AgentOpsRequestSchema,
  runAgentOps,
  type AgentOpsStore,
  type TurnRow,
} from "@/server/agent-ops.server";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

function memStore(turns: TurnRow[]) {
  const ledger: Array<{ id: string; user_id: string; turn_id: string; reason: string }> = [];
  const spends: string[] = [];
  const files = new Map<string, Array<{ path: string; content: string }>>();
  const aiLogs: Record<string, unknown>[] = [];
  const store: AgentOpsStore = {
    getTurn: async (id) => {
      const t = turns.find((x) => x.id === id);
      return t ? { ...t } : null;
    },
    readFiles: async (p) => files.get(p) ?? [],
    replaceFiles: async (p, f) => void files.set(p, f),
    readMemory: async () => [],
    readBlueprint: async () => null,
    appendEvents: async () => {},
    claimCommit: async (id) => {
      const t = turns.find((x) => x.id === id)!;
      if (t.status !== "running" || t.committed_at) return false;
      t.committed_at = "now";
      return true;
    },
    finishTurn: async (id, status) => void (turns.find((x) => x.id === id)!.status = status),
    checkBalance: async () => true,
    settle: async ({ userId, turnId }) => {
      const hit = ledger.find((l) => l.user_id === userId && l.turn_id === turnId);
      if (hit) return { charged: 0, shortfall: 0, ledgerId: hit.id, idempotent: true };
      const id = `led-${ledger.length + 1}`;
      ledger.push({ id, user_id: userId, turn_id: turnId, reason: "ai_build_charge" });
      spends.push(id);
      return { charged: 2, shortfall: 0, ledgerId: id, idempotent: false };
    },
    ledgerOwner: async (id) => {
      const l = ledger.find((x) => x.id === id);
      return l ? { user_id: l.user_id, turn_id: l.turn_id } : null;
    },
    refund: async () => true,
    logAiCall: async (r) => void aiLogs.push(r),
    savePicture: async () => {},
  };
  return { store, spends, files, aiLogs, ledger };
}

const running = (id: string, user = "u1", project = "p1"): TurnRow => ({
  id, user_id: user, project_id: project, status: "running", committed_at: null,
});

describe("agent ops signature", () => {
  const secret = "s3cret";
  const sign = (body: string, ts: number) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  it("rejects a bad signature", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySignature(secret, "{}", String(now), sign("{\"x\":1}", now))).toBe(false);
  });
  it("rejects an expired request", () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(verifySignature(secret, "{}", String(old), sign("{}", old))).toBe(false);
  });
  it("accepts a fresh valid request", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySignature(secret, "{}", String(now), sign("{}", now))).toBe(true);
  });
});

describe("agent ops allow-list", () => {
  it("rejects ops not on the list", () => {
    expect(AgentOpsRequestSchema.safeParse({ turnId: T1, ops: [{ op: "users.delete" }] }).success).toBe(false);
  });
  it("cannot name another user or project", () => {
    const r = AgentOpsRequestSchema.safeParse({ turnId: T1, ops: [{ op: "files.read", projectId: "other" }] });
    // Extra keys are stripped; the project always comes from the turn row.
    expect(r.success && (r.data.ops[0] as Record<string, unknown>).projectId).toBeFalsy();
  });
});

describe("agent ops scoping", () => {
  it("unknown turn → 404", async () => {
    const { store } = memStore([]);
    await expect(runAgentOps(store, T1, [{ op: "files.read" }])).rejects.toBeInstanceOf(AgentOpError);
  });

  it("reads and writes only the turn's own project", async () => {
    const m = memStore([running(T1, "u1", "p1"), running(T2, "u2", "p2")]);
    m.files.set("p2", [{ path: "secret.ts", content: "x" }]);
    const [r] = await runAgentOps(m.store, T1, [{ op: "files.read" }]);
    expect(r).toEqual({ ok: true, data: [] });
    await runAgentOps(m.store, T1, [{ op: "turn.claimCommit" }, { op: "files.replace", files: [{ path: "a.ts", content: "1" }] }]);
    expect(m.files.get("p1")).toEqual([{ path: "a.ts", content: "1" }]);
    expect(m.files.get("p2")).toEqual([{ path: "secret.ts", content: "x" }]);
  });

  it("ai.log identity always comes from the turn", async () => {
    const m = memStore([running(T1, "u1", "p1")]);
    await runAgentOps(m.store, T1, [{ op: "ai.log", row: { user_id: "attacker", project_id: "x", model: "m" } }]);
    expect(m.aiLogs[0]).toMatchObject({ user_id: "u1", project_id: "p1", turn_id: T1, model: "m" });
  });

  it("refund refuses another turn's ledger row", async () => {
    const m = memStore([running(T1, "u1"), running(T2, "u1")]);
    await runAgentOps(m.store, T2, [{ op: "turn.claimCommit" }, { op: "credits.settle", amount: 1 }]);
    const [r] = await runAgentOps(m.store, T1, [
      { op: "credits.refund", ledgerId: "00000000-0000-4000-8000-000000000001", reason: "x" },
    ]);
    expect(r).toEqual({ ok: false, error: "ledger_not_in_turn" });
  });
});

describe("agent ops Stop and commit", () => {
  it("writes refuse after Stop", async () => {
    const t = running(T1);
    const m = memStore([t]);
    t.status = "aborted";
    const [r] = await runAgentOps(m.store, T1, [{ op: "events.append", events: [{ seq: 1, kind: "x", payload: {} }] }]);
    expect(r).toEqual({ ok: false, error: "turn_stopped" });
  });

  it("saving files and charging need the commit claim first", async () => {
    const m = memStore([running(T1)]);
    const [a] = await runAgentOps(m.store, T1, [{ op: "files.replace", files: [] }]);
    const [b] = await runAgentOps(m.store, T1, [{ op: "credits.settle", amount: 1 }]);
    expect(a).toEqual({ ok: false, error: "commit_not_claimed" });
    expect(b).toEqual({ ok: false, error: "commit_not_claimed" });
    expect(m.spends).toHaveLength(0);
  });

  it("a closed turn cannot be finished again", async () => {
    const m = memStore([running(T1)]);
    await runAgentOps(m.store, T1, [{ op: "turn.finish", status: "failed" }]);
    const [r] = await runAgentOps(m.store, T1, [{ op: "turn.finish", status: "succeeded" }]);
    expect(r).toEqual({ ok: false, error: "turn_not_running" });
  });
});

describe("agent ops billing idempotency", () => {
  it("a replayed charge bills only once", async () => {
    const m = memStore([running(T1)]);
    const first = await runAgentOps(m.store, T1, [{ op: "turn.claimCommit" }, { op: "credits.settle", amount: 2 }]);
    const again = await runAgentOps(m.store, T1, [{ op: "credits.settle", amount: 2 }]);
    expect(m.spends).toHaveLength(1);
    expect(first[1]).toMatchObject({ ok: true, data: { idempotent: false } });
    expect(again[0]).toMatchObject({ ok: true, data: { ledgerId: "led-1", idempotent: true } });
  });
});
