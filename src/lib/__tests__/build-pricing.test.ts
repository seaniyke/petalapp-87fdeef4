import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUILD_ECONOMICS as E,
  classCostUsd,
  costPerCreditUsd,
  creditsForCost,
  estimateCredits,
  priceTurnCost,
} from "@/lib/build-pricing";
import { assessExecution } from "@/server/execution/complexity";

describe("build pricing authority", () => {
  it("derives cost per credit from revenue and margin (0.13 @ 80% = 0.026)", () => {
    expect(costPerCreditUsd(E)).toBeCloseTo(0.026, 6);
    expect(costPerCreditUsd({ ...E, targetMarginPct: 75 })).toBeCloseTo(0.0325, 6);
    expect(costPerCreditUsd({ ...E, targetMarginPct: 85 })).toBeCloseTo(0.0195, 6);
  });
  it("no 1-credit floor: tiny builds charge the configured minimum", () => {
    expect(creditsForCost(0.0001, E)).toBe(0.05);
    expect(creditsForCost(0, E)).toBe(0.05);
  });
  it("rounds UP to the 0.01 step", () => {
    expect(creditsForCost(0.026, E)).toBe(1);
    expect(creditsForCost(0.0261, E)).toBe(1.01);
    expect(creditsForCost(0.0098, E)).toBe(0.38);
  });
  it("uses actual cost when every call reports it", () => {
    const p = priceTurnCost([{ costUsd: 0.01, basis: "actual" }, { costUsd: 0.016, basis: "actual" }], E, 0.03);
    expect(p.basis).toBe("actual");
    expect(p.amount).toBe(1);
  });
  it("marks mixed actual/estimated as estimated", () => {
    expect(priceTurnCost([{ costUsd: 0.01, basis: "actual" }, { costUsd: 0.01, basis: "estimated" }], E, 0).basis).toBe("estimated");
  });
  it("unknown calls are never free: class estimate stands in", () => {
    const p = priceTurnCost([{ costUsd: 0.001, basis: "actual" }, { costUsd: null, basis: "unknown" }], E, 0.026);
    expect(p.basis).toBe("unknown");
    expect(p.unknownCalls).toBe(1);
    expect(p.amount).toBe(1);
  });
  it("margin is configurable, not hard-coded", () => {
    expect(creditsForCost(0.026, { ...E, revenuePerCreditUsd: 0.26 })).toBe(0.5);
  });
  it("class estimate uses measured p90 only when available", () => {
    expect(classCostUsd(null, 0.03)).toEqual({ usd: 0.03, basis: "default" });
    expect(classCostUsd(0.02, 0.03)).toEqual({ usd: 0.02, basis: "measured_p90" });
    expect(estimateCredits(0.03, E)).toBe(1.16);
  });
  it("rejects invalid economics", () => {
    expect(() => creditsForCost(0.01, { ...E, revenuePerCreditUsd: 0 })).toThrow();
  });
});

describe("SIMPLE class", () => {
  const base = { isInitial: false, request: "", requirementCount: 1, plannedPages: 0, existingFiles: 10, crossCutting: false, backendInvolved: false, integrations: 0 };
  it("micro edits are SIMPLE; plain edits LIGHT", () => {
    expect(assessExecution({ ...base, operation: "styling_change" }).class).toBe("SIMPLE");
    expect(assessExecution(base).class).toBe("LIGHT");
  });
});
