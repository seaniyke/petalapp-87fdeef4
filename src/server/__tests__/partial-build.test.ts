import { describe, expect, it } from "vitest";
import { runToolLoop, diagnoseTrajectory, type ModelReply, type LoopMessage, type ToolCallMsg } from "@/server/engine/tool-loop";
import { keepPartialWork, validatedWrites, effortTrees } from "@/lib/partial-build";
import { buildTerminalResult, formatTerminalResult, containsOptimisticClaim } from "@/lib/terminal-result";
import { effortScore, diffSignals, creditsForEffort, PAGE_PATH, DEFAULT_CURVE } from "@/lib/effort-pricing";
import { isUnbillableTurn } from "@/lib/build-outcome";
import { detectCrossCuttingIntent } from "@/server/intent-targets.server";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `p${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls, usage: { promptTokens: 100, cachedTokens: 0, completionTokens: 50, costUsd: 0.001 } });
const page = (x: string) => `export default function ${x}() { return <main>${x}</main>; }\n`;
const notReady = () => ({ ready: false, findings: [{ gate: "routes", reason: "app shell is missing (src/App.tsx)", paths: [] }] });

describe("Test A — builder no-progress", () => {
  it("repeated reads stop cleanly, keep earlier work, and report what is unfinished", async () => {
    const seen: LoopMessage[][] = [];
    const steps: ModelReply[] = [
      reply(call("create_file", { path: "src/pages/Home.tsx", content: page("Home") })),
      reply(call("create_file", { path: "src/pages/Dashboard.tsx", content: page("Dashboard") })),
    ];
    let calls = 0;
    const r = await runToolLoop({
      goal: "g", system: "sys", brief: "brief", validate: () => [], readiness: notReady, files: [],
      callModel: async (m) => {
        calls++;
        seen.push(m.slice());
        return steps.shift() ?? reply(call("read_file", { path: "src/pages/Home.tsx" }), call("read_file", { path: "src/pages/Dashboard.tsx" }));
      },
    });
    expect(r.outcome).toBe("no_progress");
    // Bounded: 2 writes + limit (5) + one controlled continuation (3). Never the 100-step cap.
    expect(calls).toBeLessThanOrEqual(10);
    // Earlier successful work survives.
    expect(r.files.map((f) => f.path).sort()).toEqual(["src/pages/Dashboard.tsx", "src/pages/Home.tsx"]);
    // Unfinished work is reported.
    expect(r.incomplete.join(" ")).toContain("App.tsx");
    // Re-reads of unchanged files are answered from state, not re-sent.
    const tools = seen.flatMap((s) => s.filter((x) => x.role === "tool").map((x) => String(x.content)));
    expect(tools.some((t) => t.startsWith("Unchanged since you last read src/pages/Home.tsx"))).toBe(true);
    // The one corrective signal carries the remaining-work state.
    const signal = seen.flat().find((x) => x.role === "user" && String(x.content).startsWith("No progress"));
    expect(String(signal?.content)).toContain("Remaining work");
    expect(String(signal?.content)).toContain("App.tsx");
  });

  it("the corrective signal lists remaining work and says it is the one chance", () => {
    const s = diagnoseTrajectory([], ["[routes] missing requested: /orders"]);
    expect(s).toContain("- [routes] missing requested: /orders");
    expect(s).toContain("one chance");
  });
});

describe("Test B — partial successful build", () => {
  const files = [
    { path: "src/pages/A.tsx", content: page("A") },
    { path: "src/pages/B.tsx", content: page("B") },
    { path: "src/pages/C.tsx", content: page("C") },
    { path: "src/pages/D.tsx", content: "BROKEN" },
  ];
  const validation = new Map([["src/pages/D.tsx", ["parse error"]]]);
  const kept = validatedWrites(files.map((f) => f.path), validation, files);

  it("steps 1–3 kept, step 4 not", () => {
    expect(kept.map((f) => f.path)).toEqual(["src/pages/A.tsx", "src/pages/B.tsx", "src/pages/C.tsx"]);
    expect(keepPartialWork({ isInitial: true, loopOutcome: "no_progress", committed: false, keptFiles: kept.length })).toBe(true);
    expect(keepPartialWork({ isInitial: true, loopOutcome: "breaker", committed: false, keptFiles: kept.length })).toBe(true);
  });

  it("billing prices only the kept work, through the existing effort curve, exactly once", () => {
    const keptMap = Object.fromEntries(kept.map((f) => [f.path, f.content]));
    const t = effortTrees({ baseline: {}, committedTree: null, kept: keptMap, resumedBilled: null });
    const d = diffSignals(t.from, t.to, (p) => PAGE_PATH.test(p));
    expect(d.filesCreated).toBe(3);
    const credits = creditsForEffort(effortScore({ cls: "STANDARD", ...d, capabilities: 0, validationsPassed: 0, durationMs: 0 }).score, DEFAULT_CURVE);
    expect(credits).toBeGreaterThan(0);
    // Resuming from that billed checkpoint: only new work is priced.
    const done = { ...keptMap, "src/pages/D.tsx": page("D"), "src/App.tsx": "export default function App(){return null}" };
    const r = effortTrees({ baseline: {}, committedTree: done, kept: null, resumedBilled: keptMap });
    const d2 = diffSignals(r.from, r.to, (p) => PAGE_PATH.test(p));
    expect(d2.filesCreated).toBe(2);
  });

  it("the build is clearly marked incomplete and lists what is left", () => {
    const v = buildTerminalResult({ turnId: "t", category: "verification_failed", partial: { kept: kept.map((f) => f.path), remaining: ["src/App.tsx is missing"] } });
    const text = formatTerminalResult(v);
    expect(text).toContain("stopped before it was finished");
    expect(text).toContain("src/pages/A.tsx");
    expect(text).toContain("- src/App.tsx is missing");
    expect(text).toContain("continue");
    expect(containsOptimisticClaim(text)).toBe(false);
    expect(v.projectChanged).toBe(false);
  });
});

describe("Test C — complete build unchanged", () => {
  it("nothing is kept as partial for a finished or committed build, and pricing uses the committed tree", () => {
    expect(keepPartialWork({ isInitial: true, loopOutcome: "finished", committed: false, keptFiles: 3 })).toBe(false);
    expect(keepPartialWork({ isInitial: true, loopOutcome: "no_progress", committed: true, keptFiles: 3 })).toBe(false);
    const tree = { "src/App.tsx": "x" };
    expect(effortTrees({ baseline: {}, committedTree: tree, kept: null, resumedBilled: null })).toEqual({ from: {}, to: tree });
    // Failure message without partial work is byte-identical to before.
    const v = buildTerminalResult({ turnId: "t", category: "verification_failed" });
    expect("partial" in v).toBe(false);
    expect(formatTerminalResult(v)).toContain("nothing was saved");
  });
});

describe("Test D — existing edit flow unchanged", () => {
  it("edits never keep partial work and failed edits stay unbilled", () => {
    expect(keepPartialWork({ isInitial: false, loopOutcome: "no_progress", committed: false, keptFiles: 2 })).toBe(false);
    expect(isUnbillableTurn({ changedPathCount: 0, unappliedPathCount: 1, txCommitted: false, outcomeStatus: "rolled_back", outcomeReason: "verification" })).toBe(true);
    expect(detectCrossCuttingIntent("give the patients table a toolbar with search")).toBe(false);
  });
});
