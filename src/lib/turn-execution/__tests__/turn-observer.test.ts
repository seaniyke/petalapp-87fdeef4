import { describe, expect, it } from "vitest";
import {
  deriveStage,
  deriveView,
  initialTurnState,
  MAX_PENDING,
  missingFrom,
  turnReducer,
  type RawTurnEvent,
  type TurnAction,
  type TurnState,
} from "../turn-reducer";

const T = "turn-obs";
const start: TurnAction = { type: "turn_started", turnId: T, baselineBuildId: "old" };
const run = (a: TurnAction[], from: TurnState = initialTurnState) => a.reduce(turnReducer, from);
const ev = (e: RawTurnEvent, source: "live" | "replay" = "replay"): TurnAction => ({ type: "event", event: e, source });

const log: RawTurnEvent[] = [
  { type: "phase", phase: "thinking" },
  { type: "phase", phase: "designing" },
  { type: "phase", phase: "writing" },
  { type: "file_progress", latestPath: "src/pages/Home.tsx" },
  { type: "file_complete", path: "src/pages/Home.tsx" },
  { type: "file_validated", path: "src/pages/Home.tsx", ok: false, errors: ["x"] },
  { type: "file_validated", path: "src/pages/Home.tsx", ok: true },
  { type: "phase", phase: "polishing" },
  { type: "result", files: [] },
  { type: "done", status: "succeeded" },
].map((e, i) => ({ ...e, seq: i + 1 }));
const building = { buildId: "b2", status: "building" as const, progressLabel: "Compiling", errorMessage: null, verification: null };
const ready = { ...building, status: "ready" as const, progressLabel: null, verification: { ok: true, defects: [] } };
const full = run([start, ...log.map((e) => ev(e)), { type: "deploy", snapshot: ready }]);

describe("frontend observer — stages follow backend state", () => {
  it("walks queued → understanding → planning → generating → writing → repairing → validating → building → ready → published", () => {
    const at = (n: number) => deriveStage(run([start, ...log.slice(0, n).map((e) => ev(e))]));
    expect(deriveStage(run([start]))).toBe("queued");
    expect(at(1)).toBe("understanding");
    expect(at(2)).toBe("planning");
    expect(at(3)).toBe("generating");
    expect(at(4)).toBe("writing");
    expect(at(6)).toBe("repairing");
    expect(at(8)).toBe("validating");
    expect(deriveStage(run([start, ...log.map((e) => ev(e)), { type: "deploy", snapshot: building }]))).toBe("building");
    expect(deriveStage(run([start, ...log.map((e) => ev(e)), { type: "deploy", snapshot: { ...building, progressLabel: "Running live browser check" } }]))).toBe("verifying");
    expect(deriveStage(full)).toBe("ready");
    const pub = turnReducer(full, { type: "published", buildId: "b2" });
    expect(deriveStage(pub)).toBe("published");
    expect(deriveView(pub).headline).toBe("Your app is live");
  });
  it("reading only when the backend says so", () => {
    expect(deriveStage(run([start, ev({ type: "status", message: "Reading your project files", seq: 1 })]))).toBe("reading");
    expect(deriveStage(run([start, ev({ type: "status", message: "Something else", seq: 1 })]))).toBe("starting");
  });
  it("failed and cancelled are terminal", () => {
    const failed = run([start, ev(log[0]), ev({ type: "error", message: "no", seq: 2 }), ev({ type: "done", status: "failed", seq: 3 })]);
    expect(deriveStage(failed)).toBe("failed");
    expect(deriveStage(run([start, { type: "deploy", snapshot: { ...building, status: "failed" } }], run([start, ...log.map((e) => ev(e))])))).toBe("failed");
    const cancelled = run([start, ev(log[0]), { type: "stop_requested" }, { type: "stop_result", result: "cancelled" }, ev(log[3])]);
    expect(deriveStage(cancelled)).toBe("cancelled");
    expect(cancelled.gen.paths).toEqual([]);
  });
});

describe("frontend observer — ordering, dedupe, replay", () => {
  it("duplicate events apply once", () => {
    const s = run([start, ...log.map((e) => ev(e)), ...log.map((e) => ev(e))]);
    expect(s).toEqual(run([start, ...log.map((e) => ev(e))]));
  });
  it("out-of-order events are held and applied in seq order", () => {
    const shuffled = [log[0], log[2], log[1], log[4], log[3], ...log.slice(5)];
    const s = run([start, ...shuffled.map((e) => ev(e))]);
    expect(s.gen).toEqual(run([start, ...log.map((e) => ev(e))]).gen);
  });
  it("a missed event holds later ones and reports where to replay from", () => {
    const s = run([start, ev(log[0]), ev(log[2]), ev(log[3])]);
    expect(s.gen.lastSeq).toBe(1);
    expect(missingFrom(s)).toBe(1);
    expect(deriveStage(s)).toBe("understanding");
    // Replay fills the gap; everything lands.
    const filled = run([ev({ type: "resume_start", after: 1 }), ...log.slice(1).map((e) => ev(e))], s);
    expect(missingFrom(filled)).toBeNull();
    expect(filled.gen.done).toBe("succeeded");
  });
  it("an unfillable gap is flushed in order, and overflow flushes automatically", () => {
    const s = turnReducer(run([start, ev(log[0]), ev(log[3]), ev(log[4])]), { type: "flush_pending" });
    expect(s.gen.lastSeq).toBe(5);
    expect(s.gen.paths).toEqual(["src/pages/Home.tsx"]);
    const many = Array.from({ length: MAX_PENDING }, (_, i) => ev({ type: "status", message: `step ${i}`, seq: i + 3 }));
    expect(missingFrom(run([start, ev(log[0]), ...many]))).toBeNull();
  });
  it("refresh: a fresh reducer replaying from 0 reconstructs the same state", () => {
    const refreshed = run([start, ev({ type: "resume_start", after: 0 }), ...log.map((e) => ev(e)), { type: "deploy", snapshot: ready }]);
    expect(refreshed.gen).toEqual(full.gen);
    expect(deriveStage(refreshed)).toBe("ready");
  });
  it("reconnect: replay after last acknowledged seq continues the same turn", () => {
    const before = run([start, ...log.slice(0, 4).map((e) => ev(e))]);
    expect(deriveStage(before)).toBe("writing");
    const after = run([ev({ type: "resume_start", after: before.gen.lastSeq }), ...log.map((e) => ev(e))], before);
    expect(after.gen).toEqual(run([start, ...log.map((e) => ev(e))]).gen);
  });
  it("resume on a fresh reducer mid-log starts after the server's cursor", () => {
    const s = run([start, ev({ type: "resume_start", after: 7 }), ...log.slice(7).map((e) => ev(e))]);
    expect(missingFrom(s)).toBeNull();
    expect(s.gen.done).toBe("succeeded");
  });
  it("still running after reconnect stays running on the same turn", () => {
    const s = run([start, ...log.slice(0, 3).map((e) => ev(e)), { type: "turn_started", turnId: T, baselineBuildId: "old" }]);
    expect(s.gen.lastSeq).toBe(3);
    expect(deriveView(s).lifecycle).toBe("running");
  });
  it("completion is final: late events cannot reopen it", () => {
    const s = run([ev({ type: "file_progress", latestPath: "src/x.tsx", seq: 99 }), ev({ type: "phase", phase: "thinking" }, "live")], full);
    expect(deriveStage(s)).toBe("ready");
    expect(s.gen.paths).toEqual(full.gen.paths);
  });
});
