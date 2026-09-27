import { describe, expect, it } from "vitest";
import { runToolLoop, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";
import { economicCeilingUsd, costPerCreditUsd, DEFAULT_BUILD_ECONOMICS as E } from "@/lib/build-pricing";
import { TurnCostMeter } from "@/server/turn-cost-ceiling.server";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `e${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
// A runaway model: never finishes, always makes progress-looking reads.
const runaway = (costUsd: number | null) => {
  let calls = 0;
  return {
    get calls() { return calls; },
    callModel: async (): Promise<ModelReply> => {
      calls++;
      return { content: null, toolCalls: [call("create_file", { path: `src/p${calls}.ts`, content: `export const x${calls} = ${calls};\n` })], usage: { promptTokens: 1000, cachedTokens: 0, completionTokens: 500, costUsd } };
    },
  };
};
const base = { goal: "g", system: "s", brief: "b", files: [], validate: () => [], readiness: () => ({ ready: false, findings: [{ gate: "x", reason: "never ready" }] }) as never, config: { maxIterations: 500, finalizeIterations: 0, noProgressLimit: 1000 } };

describe("economic ceiling", () => {
  it("ceiling = reserved credits × cost per credit", () => {
    expect(costPerCreditUsd(E)).toBeCloseTo(0.026, 6);
    expect(economicCeilingUsd(2, 0.03, E)).toBeCloseTo(0.052, 6);
    expect(economicCeilingUsd(null, 0.03, E)).toBeCloseTo(0.09, 6);
  });

  it("stops a runaway loop before spend exceeds the ceiling", async () => {
    const m = runaway(0.004);
    const r = await runToolLoop({ ...base, callModel: m.callModel, costCeilingUsd: 0.05 } as never);
    expect(r.outcome).toBe("breaker");
    expect(r.state.stopReason).toMatch(/economic ceiling/);
    expect(r.state.spentUsd).toBeLessThanOrEqual(0.05);
    expect(m.calls).toBe(12);
  });

  it("counts spend before the loop", async () => {
    const m = runaway(0.01);
    const r = await runToolLoop({ ...base, callModel: m.callModel, costCeilingUsd: 0.05, spentBeforeUsd: 0.03 } as never);
    expect(r.state.spentUsd).toBeLessThanOrEqual(0.05);
    expect(m.calls).toBe(2);
  });

  it("unmeasured calls are charged by costOf, never free", async () => {
    const m = runaway(null);
    const r = await runToolLoop({ ...base, callModel: m.callModel, costCeilingUsd: 0.1, costOf: () => 0.03 } as never);
    expect(m.calls).toBe(3);
    expect(r.state.spentUsd).toBeLessThanOrEqual(0.1);
  });

  it("no ceiling given = unchanged behaviour (iteration bound only)", async () => {
    const m = runaway(0.5);
    const r = await runToolLoop({ ...base, callModel: m.callModel, config: { ...base.config, maxIterations: 4 } } as never);
    expect(m.calls).toBe(4);
    expect(r.outcome).toBe("incomplete");
  });

  it("repair budget is capped to what the loop left", () => {
    const meter = new TurnCostMeter();
    meter.capAt(0.02);
    expect(meter.ceilingUsd).toBe(0.02);
    meter.capAt(1);
    expect(meter.ceilingUsd).toBe(0.02);
    expect(meter.canAfford("deepseek/deepseek-v4-flash", 100_000)).toBe(false);
  });
});
