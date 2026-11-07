import { describe, it, expect } from "vitest";
import {
  applyFloor, creditsForEffort, effortScore, estimateEffort, profitability, economicFlags,
  diffSignals, wastedCostUsd, effortConfig, DEFAULT_CURVE, PAGE_PATH, type EffortSignals,
} from "@/lib/effort-pricing";

const S = (o: Partial<EffortSignals>): EffortSignals => ({
  cls: "STANDARD", filesCreated: 0, filesModified: 0, filesDeleted: 0, linesPerFile: [],
  pages: 0, capabilities: 0, validationsPassed: 1, durationMs: 30_000, ...o,
});
const price = (o: Partial<EffortSignals>) => creditsForEffort(effortScore(S(o)).score);

describe("floor is a floor, never a flat price", () => {
  it.each([[0.08, 0.3], [0.1, 0.3], [0.17, 0.3], [0.22, 0.3], [0.29, 0.3], [0.3, 0.3]])("%s → %s", (a, b) => expect(applyFloor(a)).toBe(b));
  it.each([0.37, 0.42, 0.75, 1.2, 2.8, 5, 5.4, 6.5, 8.7, 10])("%s passes through", (a) => expect(applyFloor(a)).toBe(a));
});

describe("effort model scenarios are monotonic and in calibration ranges", () => {
  const tiny = price({ cls: "SIMPLE", filesModified: 1, linesPerFile: [2], durationMs: 10_000 });
  const simple = price({ cls: "LIGHT", filesModified: 1, linesPerFile: [20] });
  const multi = price({ filesModified: 4, linesPerFile: [30, 20, 15, 10] });
  const component = price({ filesCreated: 1, filesModified: 1, linesPerFile: [120, 5] });
  const page = price({ filesCreated: 2, filesModified: 1, pages: 1, linesPerFile: [180, 60, 4] });
  const backend = price({ filesCreated: 3, filesModified: 2, capabilities: 1, linesPerFile: [120, 80, 60, 10, 10] });
  const auth = price({ cls: "HEAVY", filesCreated: 4, filesModified: 2, pages: 2, capabilities: 2, linesPerFile: [150, 120, 90, 60, 10, 10] });
  const website = price({ filesCreated: 6, pages: 4, linesPerFile: [60, 180, 190, 170, 150, 50], validationsPassed: 3, durationMs: 170_000 });
  const complexApp = price({ cls: "COMPLEX", filesCreated: 22, filesModified: 3, pages: 9, capabilities: 3, linesPerFile: Array(25).fill(200), validationsPassed: 6, durationMs: 600_000 });

  it("tiny edit ~0.8–1.5", () => { expect(tiny).toBeGreaterThanOrEqual(0.8); expect(tiny).toBeLessThanOrEqual(1.5); });
  it("small work ~1–5", () => { expect(simple).toBeGreaterThanOrEqual(1); expect(multi).toBeLessThanOrEqual(5); });
  it("page/component medium ~2–10", () => { expect(component).toBeGreaterThan(2); expect(page).toBeLessThanOrEqual(10); });
  it("complete website is a major build ~15–30", () => { expect(website).toBeGreaterThanOrEqual(15); expect(website).toBeLessThanOrEqual(30); });
  it("complex app 40+", () => expect(complexApp).toBeGreaterThanOrEqual(40));
  it("ordered", () => {
    const seq = [tiny, simple, multi, page, backend, auth, website, complexApp];
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
  });
  it("slow infrastructure cannot raise price beyond the time cap", () => {
    expect(price({ filesModified: 1, durationMs: 3_600_000 }) - price({ filesModified: 1, durationMs: 600_000 })).toBe(0);
  });
  it("one huge file cannot dominate", () => {
    expect(price({ filesModified: 1, linesPerFile: [100_000] })).toBe(price({ filesModified: 1, linesPerFile: [300] }));
  });
});

describe("estimate", () => {
  it("uses defaults until enough samples", () => {
    expect(estimateEffort("STANDARD", { samples: 5, p75: 30 }).basis).toBe("default");
    expect(estimateEffort("STANDARD", { samples: 25, p75: 30 })).toEqual({ effort: 30, basis: "history" });
  });
});

describe("profitability and flags", () => {
  it("profitable build", () => {
    const p = profitability(5, 0.13, 0.0213);
    expect(p.revenueUsd).toBeCloseTo(0.65); expect(p.marginPct!).toBeGreaterThan(95);
    expect(economicFlags(p, { effort: 18 }, 18)).toEqual([]);
  });
  it("borderline margin not flagged at 71%", () => expect(economicFlags(profitability(1, 0.13, 0.0377), null, 1)).toEqual([]));
  it("underpriced", () => expect(economicFlags(profitability(0.3, 0.13, 0.03), null, 1)).toEqual(["underpriced"]));
  it("expensive execution (waste) is separate from underpriced", () =>
    expect(economicFlags(profitability(0.3, 0.13, 0.03, 0.02), null, 1)).toEqual(["expensive_execution"]));
  it("bad estimate", () => expect(economicFlags(profitability(5, 0.13, 0.01), { effort: 8 }, 18)).toEqual(["bad_estimate"]));
  it("waste from retries/repairs/failed calls; after-save excluded; price unaffected", () => {
    const rows = [
      { call_kind: "normal", status: 200, cost_usd_micro: 10_000, stage: "write" },
      { call_kind: "retry", status: 200, cost_usd_micro: 3_000, stage: "write" },
      { call_kind: "repair", status: 200, cost_usd_micro: 2_000, stage: "repair" },
      { call_kind: "background", status: 200, cost_usd_micro: 9_000, stage: "after" },
    ];
    expect(wastedCostUsd(rows)).toBeCloseTo(0.005);
  });
  it("failed/refunded build: zero credits → no revenue, cost remains visible", () => {
    const p = profitability(0, 0.13, 0.02);
    expect(p.revenueUsd).toBe(0); expect(p.contributionUsd).toBeCloseTo(-0.02); expect(p.marginPct).toBeNull();
  });
});

describe("signals and config", () => {
  it("diffSignals counts created/modified/deleted/pages", () => {
    const d = diffSignals({ "a.ts": "x\ny", "b.ts": "1" }, { "a.ts": "x\nz", "src/pages/Menu.tsx": "p\nq" }, (p) => PAGE_PATH.test(p));
    expect(d).toMatchObject({ filesCreated: 1, filesModified: 1, filesDeleted: 1, pages: 1 });
  });
  it("config overrides", () => {
    const c = effortConfig({ effort_curve_a: 0.5, effort_w_page: 3, min_charge_credits: 0.3 });
    expect(c.curve.a).toBe(0.5); expect(c.weights.page).toBe(3); expect(c.curve.p).toBe(DEFAULT_CURVE.p);
  });
});
