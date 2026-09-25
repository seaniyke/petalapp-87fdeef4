import { describe, expect, it } from "vitest";
import {
  deriveLifecycle,
  deriveView,
  initialTurnState,
  turnReducer,
  type RawTurnEvent,
  type TurnAction,
  type TurnState,
} from "../turn-reducer";

const T = "turn-1";
const start: TurnAction = { type: "turn_started", turnId: T, baselineBuildId: "old-build" };
const run = (actions: TurnAction[], from: TurnState = initialTurnState) => actions.reduce(turnReducer, from);
const live = (event: RawTurnEvent): TurnAction => ({ type: "event", event, source: "live" });
const replay = (event: RawTurnEvent): TurnAction => ({ type: "event", event, source: "replay" });

const script: RawTurnEvent[] = [
  { type: "phase", phase: "thinking" },
  { type: "build_steps", steps: ["Build the homepage", "Connect navigation"] },
  { type: "step_status", index: 0, status: "active" },
  { type: "file_progress", written: 1, latestPath: "src/pages/Home.tsx" },
  { type: "file_complete", path: "src/pages/Home.tsx", bytes: 900, index: 0 },
  { type: "file_validated", path: "src/pages/Home.tsx", ok: true },
  { type: "timeline", step: "image_resolve", outcome: "ok", message: "", url: "https://x/1.jpg", ts: 1 },
  { type: "step_status", index: 0, status: "done" },
  { type: "timeline", step: "esbuild_parse", outcome: "ok", message: "clean", ts: 2 },
  { type: "result", files: [], summary: "ok" },
  { type: "done", status: "succeeded" },
];
const withSeq = script.map((e, i) => ({ ...e, seq: i + 1 }));
const ready = { buildId: "b2", status: "ready" as const, progressLabel: null, errorMessage: null, verification: { ok: true, defects: [] } };

describe("turn reducer — event handling", () => {
  it("live events update state", () => {
    const s = run([start, live(script[0]), live(script[3])]);
    expect(deriveView(s).current?.label).toBe("Creating Home page");
    expect(deriveLifecycle(s)).toBe("running");
  });
  it("replay events update state", () => {
    const s = run([start, replay({ type: "resume_start", after: 0 }), ...withSeq.slice(0, 5).map(replay)]);
    expect(deriveView(s).completed.some((a) => a.label === "Created Home page")).toBe(true);
  });
  it("live and full replay converge to the same view", () => {
    const a = deriveView(run([start, ...script.map(live)]));
    const b = deriveView(run([start, replay({ type: "resume_start", after: 0 }), ...withSeq.map(replay)]));
    expect(b).toEqual(a);
  });
  it("live followed by a full replay does not double count", () => {
    const s = run([start, ...script.slice(0, 6).map(live), replay({ type: "resume_start", after: 0 }), ...withSeq.map(replay)]);
    expect(deriveView(s)).toEqual(deriveView(run([start, ...script.map(live)])));
  });
  it("duplicate seq is ignored", () => {
    const once = run([start, ...withSeq.slice(0, 6).map(replay)]);
    const twice = run([replay(withSeq[4]), replay(withSeq[5])], once);
    expect(twice).toBe(once);
  });
  it("duplicate picture event is idempotent", () => {
    const s = run([start, live(script[6]), live(script[6])]);
    expect(deriveView(s).assets).toHaveLength(1);
  });
  it("out-of-order (older seq) events never move state backward", () => {
    const s = run([start, ...withSeq.slice(0, 6).map(replay)]);
    const late = run([replay({ ...withSeq[3] })], s);
    expect(late).toBe(s);
  });
  it("terminal state remains terminal", () => {
    const s = run([start, ...script.map(live), { type: "deploy", snapshot: ready }]);
    expect(deriveLifecycle(s)).toBe("ready");
    const after = run([live({ type: "phase", phase: "writing" }), live({ type: "file_progress", latestPath: "src/X.tsx" })], s);
    expect(deriveLifecycle(after)).toBe("ready");
    const stale = run([{ type: "deploy", snapshot: { ...ready, status: "building" } }], after);
    expect(deriveLifecycle(stale)).toBe("ready");
  });
});

describe("refresh / reconnect", () => {
  const upTo = (n: number) => [start, replay({ type: "resume_start", after: 0 }), ...withSeq.slice(0, n).map(replay)];
  it("refresh during generation hydrates the current activity", () => {
    expect(deriveView(run(upTo(4))).current?.label).toBe("Creating Home page");
  });
  it("refresh during validation", () => {
    const s = run([...upTo(5), replay({ type: "file_validated", path: "src/pages/Home.tsx", ok: false, errors: ["x"], seq: 6 })]);
    expect(deriveView(s).current?.label).toMatch(/Fixing an issue/);
  });
  it("refresh during deployment shows building, not ready", () => {
    const s = run([...upTo(11), { type: "deploy", snapshot: { ...ready, status: "building", verification: null } }]);
    expect(deriveLifecycle(s)).toBe("building");
  });
  it("refresh after failure", () => {
    const s = run([start, replay({ type: "error", message: "An upstream AI service timed out.", kind: "timeout", seq: 1 }), replay({ type: "done", status: "failed", seq: 2 })]);
    const v = deriveView(s);
    expect(v.lifecycle).toBe("failed");
    expect(v.headline).toBe("Kimble couldn't finish this build");
    expect(v.detail).toMatch(/timed out/);
  });
  it("refresh after success", () => {
    expect(deriveLifecycle(run([...upTo(11), { type: "deploy", snapshot: ready }]))).toBe("ready");
  });
  it("reconnect replays only missed events and resumes live", () => {
    const first = run(upTo(4));
    const resumed = run([replay({ type: "resume_start", after: 4 }), ...withSeq.slice(2, 8).map(replay)], first);
    expect(resumed.gen.lastSeq).toBe(8);
    const labels = deriveView(resumed).completed.map((a) => a.key);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("cancellation", () => {
  it("stop during generation → stopping → cancelled", () => {
    const s = run([start, live(script[3]), { type: "stop_requested" }]);
    expect(deriveView(s).headline).toBe("Stopping…");
    const c = run([{ type: "stop_result", result: "cancelled" }], s);
    expect(deriveLifecycle(c)).toBe("cancelled");
  });
  it("stop during validation then server confirms abort", () => {
    const s = run([start, live(script[5]), { type: "stop_requested" }, live({ type: "done", status: "aborted" })]);
    expect(deriveLifecycle(s)).toBe("cancelled");
  });
  it("completion/cancel race: completion wins, never claims stopped", () => {
    const s = run([start, ...script.slice(0, 9).map(live), { type: "stop_requested" }, { type: "stop_result", result: "completion_won" }, live(script[9]), live(script[10])]);
    expect(deriveLifecycle(s)).toBe("generated");
    expect(deriveView(s).headline).not.toMatch(/Stopped/);
  });
  it("stale events after cancellation cannot resurrect the turn", () => {
    const s = run([start, { type: "stop_requested" }, { type: "stop_result", result: "cancelled" }, live(script[3]), live({ type: "done", status: "succeeded" }), { type: "deploy", snapshot: ready }]);
    expect(deriveLifecycle(s)).toBe("cancelled");
  });
});

describe("truthfulness", () => {
  const generated = [start, ...script.map(live)];
  it("generation complete does not equal ready", () => {
    expect(deriveLifecycle(run(generated))).toBe("generated");
  });
  it("browser verification failure cannot display success", () => {
    const s = run([...generated, { type: "deploy", snapshot: { ...ready, verification: { ok: false, defects: ["/menu is blank"] } } }]);
    expect(deriveLifecycle(s)).toBe("verify_failed");
    expect(deriveView(s).headline).not.toMatch(/ready/i);
  });
  it("deployment failure cannot display ready", () => {
    const s = run([...generated, { type: "deploy", snapshot: { ...ready, status: "failed", errorMessage: "install failed", verification: null } }]);
    expect(deriveLifecycle(s)).toBe("build_failed");
  });
  it("the build that was live before the turn is never treated as this turn's result", () => {
    const s = run([...generated, { type: "deploy", snapshot: { ...ready, buildId: "old-build" } }]);
    expect(deriveLifecycle(s)).toBe("generated");
  });
  it("only an authoritative ready build displays ready", () => {
    const v = deriveView(run([...generated, { type: "deploy", snapshot: ready }]));
    expect(v.headline).toBe("Your app is ready");
    expect(v.completed.map((a) => a.label)).toContain("Checked your live pages");
  });
  it("filler status lines are never narrated", () => {
    const s = run([start, live({ type: "status", message: "Still working — Kimble is keeping the build connected." })]);
    expect(s.gen.tech).toHaveLength(0);
  });
});

describe("view states", () => {
  it("empty state is idle", () => {
    expect(deriveView(initialTurnState).lifecycle).toBe("idle");
  });
  it("human mode hides paths; technical detail keeps them", () => {
    const v = deriveView(run([start, ...script.slice(0, 6).map(live)]));
    const home = v.completed.find((a) => a.key === "file:src/pages/Home.tsx")!;
    expect(home.label).toBe("Created Home page");
    expect(home.tech).toBe("src/pages/Home.tsx");
    expect(v.tech.some((l) => l.includes("src/pages/Home.tsx"))).toBe(true);
  });
  it("answered turns (no file changes) never show a build", () => {
    const s = run([start, live({ type: "result", files: [], summary: "hi", noFileChanges: true }), live({ type: "done", status: "succeeded" })]);
    expect(deriveLifecycle(s)).toBe("answered");
  });
});

describe("stage 5 projections (replacing builder-local state)", () => {
  const evs: RawTurnEvent[] = [
    { type: "build_steps", steps: ["Home", "Menu"] },
    { type: "step_status", index: 0, status: "active" },
    { type: "file_progress", latestPath: "src/pages/Home.tsx" },
    { type: "narration", path: "src/pages/Home.tsx", text: "Laying out the hero" },
    { type: "file_complete", path: "src/pages/Home.tsx", bytes: 10, index: 0 },
    { type: "file_progress", latestPath: "src/pages/Menu.tsx" },
    { type: "narration", path: "src/pages/Home.tsx", text: "late narration" },
    { type: "timeline", step: "image_resolve", outcome: "ok", message: "", url: "https://x/a.jpg", ts: 5 },
    { type: "timeline", step: "image_resolve", outcome: "ok", message: "", url: "https://x/a.jpg", ts: 6 },
  ];
  const v = deriveView(run([start, ...evs.map(live)]));
  it("keeps files in write order with completion ticks", () => {
    expect(v.writtenPaths).toEqual(["src/pages/Home.tsx", "src/pages/Menu.tsx"]);
    expect([...v.completedPaths]).toEqual(["src/pages/Home.tsx"]);
  });
  it("narration follows the current file and drops late lines", () => {
    expect(v.latestPath).toBe("src/pages/Menu.tsx");
    expect(v.latestNarration).toBeUndefined();
  });
  it("plan step stays active while files are written", () => {
    expect(v.activeStepIndex).toBe(0);
    expect(v.doneStepIndexes).toEqual([]);
    expect(v.current?.label).toBe("Made 1 picture");
  });
  it("timeline dedupes pictures", () => {
    expect(v.timeline.filter((t) => t.url)).toHaveLength(1);
  });
  it("finishing closes every step", () => {
    const d = deriveView(run([start, ...evs.map(live), live({ type: "done", status: "succeeded" })]));
    expect(d.doneStepIndexes).toEqual([0]);
  });
});

describe("setup stages", () => {
  it("shows real setup status lines and never moves the phase backwards", () => {
    const s = run([
      start,
      live({ type: "phase", phase: "thinking" }),
      live({ type: "status", message: "Working out what your app needs to do…" }),
      live({ type: "phase", phase: "designing" }),
      live({ type: "status", message: "Choosing a design direction…" }),
      live({ type: "phase", phase: "thinking" }),
    ]);
    const v = deriveView(s);
    expect(v.current?.label).toBe("Choosing a design direction");
    expect(v.detail).toBe("Choosing a design direction…");
  });
});
