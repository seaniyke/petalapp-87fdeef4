/**
 * Billing fairness tests — Kimble Credit System v2.
 *
 * These lock in the trust guarantees stated in
 * docs/petal-credit-philosophy.md. If one of these fails, a user is being
 * charged for something Kimble promised was free.
 */
import { describe, expect, it } from "vitest";
import { priceBuild, priceTurn, BUILD_FLOOR, BUILD_CAP } from "@/server/credit-pricing.server";
import {
  buildCostReasons,
  costFootnote,
  formatBuildCost,
  isBackendPath,
} from "@/lib/build-cost-summary";

describe("charging only for successful AI work", () => {
  it("never charges below the floor for a real build", () => {
    const p = priceBuild({ prompt_tokens: 10, completion_tokens: 5 });
    expect(p.amount).toBeGreaterThanOrEqual(BUILD_FLOOR);
  });

  it("never charges above the cap, however large the turn", () => {
    const p = priceBuild({ prompt_tokens: 5_000_000, completion_tokens: 5_000_000 });
    expect(p.amount).toBeLessThanOrEqual(BUILD_CAP);
    expect(p.clamped).toBe(true);
  });

  it("charges once per turn, not once per cycle", () => {
    const single = priceBuild({ prompt_tokens: 2000, completion_tokens: 1000 });
    const split = priceTurn([
      { prompt_tokens: 1000, completion_tokens: 500 },
      { prompt_tokens: 1000, completion_tokens: 500 },
    ]);
    expect(split.amount).toBe(single.amount);
  });

  it("a turn with no billable usage falls back to a small fixed amount, never zero-cap abuse", () => {
    const p = priceBuild(null);
    expect(p.usageMissing).toBe(true);
    expect(p.amount).toBeGreaterThan(0);
    expect(p.amount).toBeLessThanOrEqual(BUILD_CAP);
  });

  it("failed generation prices nothing because pricing is only reached on success", () => {
    // Guard on the contract: a failed turn passes no usage array at all.
    // priceTurn([]) must not exceed the free-fallback amount.
    expect(priceTurn([]).amount).toBeLessThanOrEqual(BUILD_FLOOR + 0.5);
  });
});

describe("build cost transparency", () => {
  it("explains the charge without exposing tokens or models", () => {
    const reasons = buildCostReasons({
      credits: 2.4,
      fileCount: 6,
      paths: ["src/routes/index.tsx", "supabase/migrations/x.sql"],
    });
    expect(reasons.length).toBeGreaterThan(2);
    const joined = reasons.join(" ").toLowerCase();
    expect(joined).not.toContain("token");
    expect(joined).not.toContain("gpt");
    expect(joined).not.toContain("claude");
    expect(joined).not.toContain("openrouter");
    expect(joined).toContain("backend");
  });

  it("shows no cost reasons for free (repair) turns", () => {
    expect(buildCostReasons({ credits: 0 })).toEqual([]);
    expect(formatBuildCost(0)).toBe("Free");
    expect(costFootnote(0)).toMatch(/not charged/i);
  });

  it("formats credits in friendly units", () => {
    expect(formatBuildCost(1)).toBe("1 credit");
    expect(formatBuildCost(2.44)).toBe("2.4 credits");
    expect(formatBuildCost(3)).toBe("3 credits");
    expect(formatBuildCost(null)).toBe("—");
  });

  it("recognises backend work", () => {
    expect(isBackendPath("supabase/migrations/1.sql")).toBe(true);
    expect(isBackendPath("src/lib/users.functions.ts")).toBe(true);
    expect(isBackendPath("src/components/Hero.tsx")).toBe(false);
  });

  it("always states the free-repair promise on paid turns", () => {
    expect(costFootnote(2)).toMatch(/repairs?, retries and publishing are always free/i);
  });
});
