import { describe, expect, it } from "vitest";
import {
  CLOUD_RATE_DEFAULTS as R,
  externalPriceUsd,
  grossMarginPct,
  priceExternal,
  priceShared,
  railwayCosts,
  sharedPriceUsd,
  supabaseCosts,
  usdToCredits,
} from "@/lib/cloud-pricing";

describe("30% gross margin (not markup)", () => {
  it("$10 cost → $14.29 price, 30% margin", () => {
    const p = externalPriceUsd(10, 30);
    expect(p).toBeCloseTo(14.285714, 5);
    expect(grossMarginPct(p, 10)).toBeCloseTo(30, 1);
    expect(p).not.toBeCloseTo(13, 1); // not cost × 1.30
  });
  it("zero or bad cost prices to 0", () => {
    expect(externalPriceUsd(0, 30)).toBe(0);
    expect(externalPriceUsd(Number.NaN, 30)).toBe(0);
  });
});

describe("Shared Cloud = 50% below equivalent dedicated", () => {
  it("$14.29 dedicated → ~$7.14 shared", () => {
    expect(sharedPriceUsd(14.285714, 50)).toBeCloseTo(7.142857, 5);
  });
  it("is never free and always cheaper than dedicated", () => {
    const shared = priceShared({ hours: 730, projectRows: 10, totalRows: 1000, sharedMonthlyBillUsd: null }, R);
    const dedicated = externalPriceUsd(R.supabaseMicroHourUsd * 730, 30);
    expect(shared.priceUsd).toBeGreaterThan(0);
    expect(shared.priceUsd).toBeCloseTo(dedicated / 2, 5);
    expect(shared.credits).toBeGreaterThan(0);
  });
  it("cost is UNKNOWN without a shared bill, ALLOCATED by row share with one", () => {
    const unknown = priceShared({ hours: 24, projectRows: 10, totalRows: 100, sharedMonthlyBillUsd: null }, R);
    expect(unknown.costs[0].basis).toBe("UNKNOWN");
    expect(unknown.costs[0].costUsd).toBeNull();
    expect(unknown.marginPct).toBeNull();
    const alloc = priceShared({ hours: 730, projectRows: 10, totalRows: 100, sharedMonthlyBillUsd: 25 }, R);
    expect(alloc.costs[0].basis).toBe("ALLOCATED");
    expect(alloc.costs[0].costUsd).toBeCloseTo(2.5, 5);
  });
});

describe("credits", () => {
  it("customer USD ÷ revenue per credit, rounded up", () => {
    expect(usdToCredits(0.13, 0.13)).toBe(1);
    expect(usdToCredits(0.000001, 0.13)).toBeGreaterThan(0);
    expect(usdToCredits(0, 0.13)).toBe(0);
  });
});

describe("Railway measured usage", () => {
  it("prices each resource at the published rate, ACTUAL", () => {
    const c = railwayCosts({ cpuVcpuMinutes: 60, memoryGbMinutes: 60, diskGbMinutes: 0, egressGb: 1 }, R);
    expect(c.map((x) => x.basis)).toEqual(["ACTUAL", "ACTUAL", "ACTUAL", "ACTUAL"]);
    expect(c[0].costUsd).toBeCloseTo(0.02778, 5);
    expect(c[3].costUsd).toBeCloseTo(0.05, 5);
    const p = priceExternal(c, R);
    expect(p.marginPct).toBeCloseTo(30, 0);
  });
});

describe("Supabase dedicated", () => {
  it("compute from rate × hours; disk only beyond the included 8 GB; egress UNKNOWN", () => {
    const c = supabaseCosts({ hours: 1, computeHourUsd: null, computeFromProvider: false, diskGb: 2 }, R);
    expect(c[0].costUsd).toBeCloseTo(0.01344, 6);
    expect(c[1].costUsd).toBe(0);
    expect(c[2].basis).toBe("UNKNOWN");
    const p = priceExternal(c, R);
    expect(p.priceUsd).toBeCloseTo(0.0192, 5);
  });
  it("unreadable disk is UNKNOWN, not $0", () => {
    const c = supabaseCosts({ hours: 1, computeHourUsd: 0.0206, computeFromProvider: true, diskGb: null }, R);
    expect(c[1].basis).toBe("UNKNOWN");
    expect(c[1].costUsd).toBeNull();
  });
});
