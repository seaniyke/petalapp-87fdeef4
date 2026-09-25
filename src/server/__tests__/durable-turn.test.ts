/**
 * Durable turn lifecycle — the browser is an observer, not the engine.
 * Scenarios: refresh, reconnect, disconnect, cancel, completion/cancel race,
 * worker crash/restart, duplicate event, missed event, duplicate settlement,
 * duplicate commit.
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentOps, type AgentOpsStore, type TurnRow } from "@/server/agent-ops.server";
import { startHeartbeat, type BeatState } from "@/server/turn-lease";
import { turnReducer, initialTurnState, deriveView, type RawTurnEvent, type TurnAction, type TurnState } from "@/lib/turn-execution/turn-reducer";

const T = "33333333-3333-4333-8333-333333333333";
const L1 = "44444444-4444-4444-8444-444444444444";
const L2 = "55555555-5555-4555-8555-555555555555";

/** In-memory mirror of the database rules (unique seq, lease, guards). */
function db() {
  const turn: TurnRow & { lease: string | null; heartbeat: number } = {
    id: T, user_id: "u1", project_id: "p1", status: "running", committed_at: null, lease: null, heartbeat: 0,
  };
  const events = new Map<number, { kind: string }>();
  const ledger: string[] = [];
  let commits = 0;
  let fileWrites = 0;
  const store: AgentOpsStore = {
    getTurn: async () => ({ id: turn.id, user_id: turn.user_id, project_id: turn.project_id, status: turn.status, committed_at: turn.committed_at }),
    readFiles: async () => [],
    replaceFiles: async () => void fileWrites++,
    readMemory: async () => [],
    readBlueprint: async () => null,
    saveBlueprint: async () => {},
    appendEvents: async (_id, evs) => {
      for (const e of evs) if (!events.has(e.seq)) events.set(e.seq, { kind: e.kind }); // ON CONFLICT DO NOTHING
    },
    heartbeat: async (_id, lease) => {
      if (turn.status !== "running") return "terminal";
      if (turn.lease && turn.lease !== lease) return "lost";
      turn.lease = lease;
      turn.heartbeat = Date.now();
      return "ok";
    },
    claimCommit: async () => {
      if (turn.status !== "running" || turn.committed_at) return false;
      turn.committed_at = "now";
      commits++;
      return true;
    },
    finishTurn: async (_id, status) => {
      if (turn.status === "running" || turn.status === "awaiting_credits") turn.status = status;
    },
    checkBalance: async () => true,
    settle: async () => {
      if (ledger.includes(T)) return { charged: 0, shortfall: 0, ledgerId: "l1", idempotent: true };
      ledger.push(T);
      return { charged: 3, shortfall: 0, ledgerId: "l1", idempotent: false };
    },
    ledgerOwner: async () => null,
    refund: async () => true,
    logAiCall: async () => null,
    updateAiCall: async () => false,
    savePicture: async () => {},
    runRpc: async () => ({ data: null, error: null }),
    runQuery: async () => ({ data: [], error: null }),
    generateImage: async () => ({ url: "https://x/y.png", cached: false }),
  };
  const cancel = () => {
    if (turn.status === "running" && !turn.committed_at) turn.status = "aborted";
  };
  return { store, turn, events, ledger, cancel, get commits() { return commits; }, get fileWrites() { return fileWrites; } };
}

const ev = (seq: number, type: string, extra: Record<string, unknown> = {}): RawTurnEvent => ({ type, seq, ...extra });
const script: RawTurnEvent[] = [
  ev(1, "status", { phase: "thinking", message: "Reading your request" }),
  ev(2, "status", { phase: "writing", message: "Writing pages" }),
  ev(3, "file", { path: "src/pages/Home.tsx" }),
  ev(4, "file", { path: "src/pages/About.tsx" }),
  ev(5, "result", { creditsCharged: 3 }),
  ev(6, "done", {}),
];
const start: TurnAction = { type: "turn_started", turnId: T, baselineBuildId: null };
const run = (actions: TurnAction[], s: TurnState = initialTurnState) => actions.reduce(turnReducer, s);
const live = (e: RawTurnEvent): TurnAction => ({ type: "event", event: e, source: "live" });
const replay = (e: RawTurnEvent): TurnAction => ({ type: "event", event: e, source: "replay" });

describe("refresh / reconnect / disconnect", () => {
  it("refresh during generation: a fresh page rebuilds the same state from persisted events", () => {
    const watched = deriveView(run([start, ...script.map(live)]));
    const refreshed = deriveView(run([start, replay({ type: "resume_start", after: 0 }), ...script.map(replay)]));
    expect(refreshed).toEqual(watched);
  });
  it("reconnect resumes after the last seen seq without double counting", () => {
    const before = run([start, ...script.slice(0, 3).map(live)]);
    expect(before.gen.lastSeq).toBe(3);
    const after = run([replay({ type: "resume_start", after: 3 }), ...script.map(replay)], before);
    expect(deriveView(after)).toEqual(deriveView(run([start, ...script.map(live)])));
  });
  it("disconnect: the worker keeps writing events with no browser attached", async () => {
    const d = db();
    for (const e of script) await runAgentOps(d.store, T, [{ op: "events.append", events: [{ seq: e.seq!, kind: e.type, payload: e }] }]);
    expect(d.events.size).toBe(6);
  });
});

describe("duplicate / missed events", () => {
  it("duplicate event: a retried flush never duplicates a seq", async () => {
    const d = db();
    const batch = [{ seq: 1, kind: "status", payload: {} }, { seq: 2, kind: "file", payload: {} }];
    await runAgentOps(d.store, T, [{ op: "events.append", events: batch }]);
    const r = await runAgentOps(d.store, T, [{ op: "events.append", events: batch }]);
    expect(r[0]!.ok).toBe(true);
    expect(d.events.size).toBe(2);
  });
  it("duplicate event in the browser is ignored by seq", () => {
    const once = run([start, ...script.slice(0, 4).map(live)]);
    const twice = run([replay(script[2]!), replay(script[3]!)], once);
    expect(deriveView(twice)).toEqual(deriveView(once));
  });
  it("missed event: replay fills the gap", () => {
    const gappy = run([start, live(script[0]!), live(script[1]!), live(script[3]!)]);
    const healed = run([replay({ type: "resume_start", after: 0 }), ...script.map(replay)], gappy);
    expect(deriveView(healed)).toEqual(deriveView(run([start, ...script.map(live)])));
  });
});

describe("cancellation", () => {
  it("cancel reaches the worker: its next write is refused and its heartbeat says terminal", async () => {
    const d = db();
    d.cancel();
    const w = await runAgentOps(d.store, T, [{ op: "events.append", events: [{ seq: 1, kind: "x", payload: {} }] }]);
    expect(w[0]).toEqual({ ok: false, error: "turn_stopped" });
    const hb = await runAgentOps(d.store, T, [{ op: "turn.heartbeat", lease: L1 }]);
    expect((hb[0] as { data: { state: BeatState } }).data.state).toBe("terminal");
  });
  it("completion/cancellation race: Stop first → commit refused, nothing saved or charged", async () => {
    const d = db();
    d.cancel();
    const r = await runAgentOps(d.store, T, [{ op: "turn.claimCommit" }]);
    expect(r[0]!.ok).toBe(false);
    expect(d.commits).toBe(0);
    expect(d.ledger).toEqual([]);
  });
  it("completion/cancellation race: commit first → Stop cannot undo it, and the late finish is not overwritten", async () => {
    const d = db();
    await runAgentOps(d.store, T, [{ op: "turn.claimCommit" }]);
    d.cancel();
    expect(d.turn.status).toBe("running");
    await runAgentOps(d.store, T, [{ op: "turn.finish", status: "succeeded" }]);
    const late = await runAgentOps(d.store, T, [{ op: "turn.finish", status: "aborted" }]);
    expect(late[0]!.ok).toBe(false);
    expect(d.turn.status).toBe("succeeded");
  });
});

describe("worker crash / restart and stale workers", () => {
  it("a second worker cannot take over a turn another worker holds", async () => {
    const d = db();
    const a = await runAgentOps(d.store, T, [{ op: "turn.heartbeat", lease: L1 }]);
    const b = await runAgentOps(d.store, T, [{ op: "turn.heartbeat", lease: L2 }]);
    expect((a[0] as { data: { state: string } }).data.state).toBe("ok");
    expect((b[0] as { data: { state: string } }).data.state).toBe("lost");
  });
  it("a worker that learns it lost the lease stops its own run", async () => {
    const onLost = vi.fn();
    const hb = startHeartbeat({ turnId: T, lease: L2, beat: async () => "lost", onLost, setIntervalFn: (() => 0) as never, clearIntervalFn: (() => {}) as never });
    await hb.tick();
    expect(onLost).toHaveBeenCalledWith("lost");
    expect(onLost).toHaveBeenCalledTimes(1);
  });
  it("a missed heartbeat (network error) is not treated as loss", async () => {
    const onLost = vi.fn();
    const hb = startHeartbeat({ turnId: T, lease: L1, beat: async () => { throw new Error("net"); }, onLost, setIntervalFn: (() => 0) as never, clearIntervalFn: (() => {}) as never });
    expect(await hb.tick()).toBe("ok");
    expect(onLost).not.toHaveBeenCalled();
  });
  it("heartbeats continue while quiet, so a long AI call is not a dead worker", async () => {
    const d = db();
    await runAgentOps(d.store, T, [{ op: "turn.heartbeat", lease: L1 }]);
    expect(d.turn.heartbeat).toBeGreaterThan(0);
    expect(d.events.size).toBe(0);
  });
});

describe("exactly once", () => {
  it("duplicate credit settlement bills once", async () => {
    const d = db();
    await runAgentOps(d.store, T, [{ op: "turn.claimCommit" }]);
    const a = await runAgentOps(d.store, T, [{ op: "credits.settle", amount: 3, metadata: {} }]);
    const b = await runAgentOps(d.store, T, [{ op: "credits.settle", amount: 3, metadata: {} }]);
    expect(a[0]!.ok && b[0]!.ok).toBe(true);
    expect(d.ledger).toHaveLength(1);
    expect((b[0] as { data: { idempotent: boolean } }).data.idempotent).toBe(true);
  });
  it("duplicate project commit: the second claim loses", async () => {
    const d = db();
    const a = await runAgentOps(d.store, T, [{ op: "turn.claimCommit" }]);
    const b = await runAgentOps(d.store, T, [{ op: "turn.claimCommit" }]);
    expect(a[0]!.ok).toBe(true);
    expect(b[0]).toEqual({ ok: false, error: "commit_lost" });
    expect(d.commits).toBe(1);
  });
  it("files cannot be saved without the commit claim", async () => {
    const d = db();
    const r = await runAgentOps(d.store, T, [{ op: "files.replace", files: [{ path: "a.tsx", content: "x" }] }]);
    expect(r[0]).toEqual({ ok: false, error: "commit_not_claimed" });
    expect(d.fileWrites).toBe(0);
  });
});
