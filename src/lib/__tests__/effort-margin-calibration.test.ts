import { describe, it, expect } from "vitest";
import { creditsForEffort, profitability, DEFAULT_CURVE } from "@/lib/effort-pricing";

/**
 * User rule (7 Nov 2026): one credit sells at $0.15 and every build should
 * earn 50–60% profit (at least ~45%) over the raw AI Gateway bill.
 * Costs below are real measured token counts from past Petal builds, priced
 * at gateway rates per M tokens (in / cached / out):
 *   frontier first-build model 8 / 0.4 / 40, fast edit model 3 / 0.3 / 15.
 */
const ARGON = [8, 0.4, 40] as const;
const FLASH = [3, 0.3, 15] as const;
const cost = (prompt: number, cached: number, out: number, m: readonly number[]) =>
  ((prompt - cached) * m[0] + cached * m[1] + out * m[2]) / 1e6;
const margin = (effort: number, usd: number) => profitability(creditsForEffort(effort, DEFAULT_CURVE), 0.15, usd).marginPct!;

describe("effort price earns the target margin on measured builds", () => {
  it("hospital app (effort 61.88) earns at least 45%", () =>
    expect(margin(61.88, cost(1_269_054, 954_801, 40_283, ARGON))).toBeGreaterThanOrEqual(45));
  it("delivery app (effort 39.86) earns at least 50%", () =>
    expect(margin(39.86, cost(771_332, 691_496, 18_911, ARGON))).toBeGreaterThanOrEqual(50));
  it("salon booking app (effort 36.35) earns at least 50%", () =>
    expect(margin(36.35, cost(853_249, 754_837, 19_430, ARGON))).toBeGreaterThanOrEqual(50));
  it("simple cloud app (effort 17.29) earns at least 50%", () =>
    expect(margin(17.29, cost(649_789, 596_197, 9_261, ARGON))).toBeGreaterThanOrEqual(50));
  it("a small edit (effort 2.95) earns at least 50%", () =>
    expect(margin(2.95, cost(41_198, 9_216, 652, FLASH))).toBeGreaterThanOrEqual(50));
  it("credit price stays $0.15 — the curve, not the credit, carries the increase", () =>
    expect(profitability(1, 0.15, 0).revenueUsd).toBeCloseTo(0.15));
});
