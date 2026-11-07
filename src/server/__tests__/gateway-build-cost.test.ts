import { describe, expect, it } from "vitest";
import { estimateCostUsdMicro, modelPricePerM } from "@/server/ai-provider.server";
import { estimateFirstBuildCost, predictCallCostUsd, DEFAULT_FIRST_BUILD_TOKENS, type TokenSample } from "@/server/engine/loop-cost-estimate";
import { economicCeilingUsd, DEFAULT_BUILD_ECONOMICS as E } from "@/lib/build-pricing";
import { runToolLoop, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";

const argon = modelPricePerM("google/gemini-4-argon");

describe("gateway prices (catalog 7 Nov 2026)", () => {
  it("cached prompt tokens bill at the cache-read rate", () => {
    // Delivery app: 771,332 prompt / 691,496 cached / 18,911 out on Argon.
    const usd = estimateCostUsdMicro("google/gemini-4-argon", 771_332, 18_911, 691_496)! / 1e6;
    expect(usd).toBeCloseTo(0.6387 + 0.2766 + 0.7564, 3);
    // Without cache info every prompt token is full price (old behaviour).
    expect(estimateCostUsdMicro("google/gemini-4-argon", 771_332, 18_911)! / 1e6).toBeCloseTo(6.9271, 3);
  });

  it("uses the real catalog rate for each routed model", () => {
    expect(modelPricePerM("google/gemini-3.8-flash")).toEqual({ inUsd: 3, cachedInUsd: 0.3, outUsd: 15 });
    expect(modelPricePerM("google/gemini-4-argon")).toEqual({ inUsd: 8, cachedInUsd: 0.4, outUsd: 40 });
    expect(modelPricePerM("google/gemini-3.1-flash-lite")).toEqual({ inUsd: 1, cachedInUsd: 0.1, outUsd: 6 });
    expect(modelPricePerM("openai/gpt-5.6-luna")).toEqual({ inUsd: 0.8, cachedInUsd: 0.08, outUsd: 4.8 });
    expect(modelPricePerM("openai/gpt-5.6-sol")).toEqual({ inUsd: 16, cachedInUsd: 1.6, outUsd: 80 });
  });

  it("cached count larger than prompt can never make a call cheaper than all-cached", () => {
    expect(estimateCostUsdMicro("google/gemini-4-argon", 1000, 0, 5000)).toBe(400);
  });
});

describe("first-build runaway ceiling", () => {
  const measured: TokenSample[] = Array.from({ length: 20 }, (_, i) => ({ prompt: 500_000 + i * 20_000, cached: 400_000, completion: 15_000 }));

  it("uses measured p90 at the loop's model once there are enough samples", () => {
    const e = estimateFirstBuildCost(measured, argon, 20);
    expect(e.basis).toBe("measured_p90");
    expect(e.samples).toBe(20);
    // p90 sample ≈ 842k prompt (442k uncached), 400k cached, 15k out.
    expect(e.usd).toBeCloseTo((442_000 * 8 + 400_000 * 0.4 + 15_000 * 40) / 1e6, 2);
  });

  it("falls back to the measured default profile below the sample minimum", () => {
    const e = estimateFirstBuildCost(measured.slice(0, 5), argon, 20);
    expect(e.basis).toBe("default");
    expect(e.usd).toBeCloseTo(((DEFAULT_FIRST_BUILD_TOKENS.prompt - DEFAULT_FIRST_BUILD_TOKENS.cached) * 8 + DEFAULT_FIRST_BUILD_TOKENS.cached * 0.4 + DEFAULT_FIRST_BUILD_TOKENS.completion * 40) / 1e6, 4);
  });

  it("a normal Argon first build fits under size estimate × headroom; the old flat cap did not", () => {
    const size = estimateFirstBuildCost([], argon, 20).usd;
    const ceiling = economicCeilingUsd(null, Math.max(0.05, size), E);
    const deliveryBuild = estimateCostUsdMicro("google/gemini-4-argon", 771_332, 18_911, 691_496)! / 1e6;
    expect(deliveryBuild).toBeLessThan(ceiling);
    expect(economicCeilingUsd(null, 0.05, E)).toBeLessThan(deliveryBuild); // HEAVY default × 3 = $0.15
  });

  it("predicts the next call pessimistically (no cache, typical output)", () => {
    expect(predictCallCostUsd(40_000, argon)).toBeCloseTo((40_000 * 8 + 4_000 * 40) / 1e6, 6);
  });
});

describe("loop checks the first call against the ceiling", () => {
  let n = 0;
  const call = (path: string): ToolCallMsg => ({ id: `g${++n}`, type: "function", function: { name: "create_file", arguments: JSON.stringify({ path, content: "export const a = 1;\n" }) } });
  const base = { goal: "g", system: "s", brief: "b", files: [], validate: () => [], readiness: () => ({ ready: false, findings: [{ gate: "x", reason: "never" }] }) as never, config: { maxIterations: 50, finalizeIterations: 0, noProgressLimit: 1000 } };

  it("never sends a call whose predicted cost alone exceeds the ceiling", async () => {
    let calls = 0;
    const callModel = async (): Promise<ModelReply> => { calls++; return { content: null, toolCalls: [call(`src/x${calls}.ts`)], usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 10, costUsd: 0.001 } }; };
    const r = await runToolLoop({ ...base, callModel, costCeilingUsd: 1, predictCallUsd: () => 2 } as never);
    expect(calls).toBe(0);
    expect(r.outcome).toBe("breaker");
  });

  it("without a prediction the old largest-seen rule still applies", async () => {
    let calls = 0;
    const callModel = async (): Promise<ModelReply> => { calls++; return { content: null, toolCalls: [call(`src/y${calls}.ts`)], usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 10, costUsd: 0.3 } }; };
    const r = await runToolLoop({ ...base, callModel, costCeilingUsd: 1 } as never);
    expect(calls).toBe(3);
    expect(r.state.spentUsd).toBeLessThanOrEqual(1);
  });
});
