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
    expect(creditsForCost(0.0001, E)).toBe(0.3);
    expect(creditsForCost(0, E)).toBe(0.3);
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

import { priceRecordedCalls } from "@/lib/build-pricing";
describe("0.30 floor and recorded-call settlement", () => {
  const E2 = { revenuePerCreditUsd: 0.13, targetMarginPct: 80, minChargeCredits: 0.3, roundingStep: 0.01, reservationHeadroom: 3 };
  const c = (credits: number) => creditsForCost(credits * 0.026, E2);
  it("floor, not flat price", () => {
    expect(c(0.1)).toBe(0.3); expect(c(0.22)).toBe(0.3); expect(c(0.3)).toBe(0.3);
    expect(c(0.37)).toBe(0.37); expect(c(0.82)).toBe(0.82); expect(c(1.7)).toBe(1.7);
  });
  const row = (micro: number | null, stage = "write", status = 200, basis = "actual") => ({ stage, call_kind: "normal", status, cost_usd_micro: micro, cost_basis: basis });
  it("bakery benchmark: every pre-commit call counts, final step included", () => {
    const rows = [row(602, "request"), row(254, "plan"), row(387, "request"),
      ...[2675,819,950,1042,1028,1339,1461,1061,1247,1579,1336,1422,1246,1758,1109].map((m) => row(m)), row(158, "after")];
    const p = priceRecordedCalls(rows, E2, 0.03);
    expect(p.costUsd).toBeCloseTo(0.021315, 6);
    expect(p.amount).toBe(0.82);
    expect(p.billableCalls).toBe(18);
    expect(p.overheadCalls).toBe(1);
    // dropping the final AI step must change the charge — it cannot be omitted silently
    expect(priceRecordedCalls(rows.slice(0, -2).concat(rows.slice(-1)), E2, 0.03).costUsd).toBeLessThan(p.costUsd);
  });
  it("unknown cost never free; rejected request is $0", () => {
    expect(priceRecordedCalls([row(null)], E2, 0.03).basis).toBe("unknown");
    expect(priceRecordedCalls([row(null)], E2, 0.03).costUsd).toBe(0.03);
    expect(priceRecordedCalls([row(null, "write", 502)], E2, 0.03).costUsd).toBe(0);
  });
});
