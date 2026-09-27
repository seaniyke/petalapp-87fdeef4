/**
 * Billing fairness tests — Kimble Credit System v2.
 *
 * These lock in the trust guarantees stated in
 * docs/petal-credit-philosophy.md. If one of these fails, a user is being
 * charged for something Kimble promised was free.
 */
import { describe, expect, it } from "vitest";
import {
  buildCostReasons,
  costFootnote,
  formatBuildCost,
  isBackendPath,
} from "@/lib/build-cost-summary";

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

