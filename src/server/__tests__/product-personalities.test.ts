import { describe, expect, it } from "vitest";
import { pickProductPersonality, PRODUCT_PERSONALITY_IDS } from "@/server/design/product-personalities";
import { pickLayoutArchetype } from "@/server/design/layout-archetypes";
import { resolvePackageForIntent } from "@/server/design-systems/authority";

const saas = "Build a SaaS for invoicing small agencies";

describe("product personalities", () => {
  it("different projects asking for a SaaS get several different personalities", () => {
    const ids = new Set(Array.from({ length: 40 }, (_, i) => pickProductPersonality(saas, `project-${i}`)!.id));
    expect(ids.size).toBe(PRODUCT_PERSONALITY_IDS.length);
  });

  it("one project always keeps its personality", () => {
    expect(pickProductPersonality(saas, "p1")!.id).toBe(pickProductPersonality(saas, "p1")!.id);
  });

  it("reference words win: 'like Linear' gives the terminal personality", () => {
    expect(pickProductPersonality("A SaaS like Linear for bug tracking", "x")!.id).toBe("terminal");
    expect(pickProductPersonality("A SaaS like Stripe for payouts", "x")!.id).toBe("enterprise");
  });

  it("layout and look follow the same personality", () => {
    const p = pickProductPersonality(saas, "seed-7")!;
    expect(pickLayoutArchetype(saas, "seed-7")).toBe(p.layout);
    expect(resolvePackageForIntent(saas, { seed: "seed-7" })!.pkg.meta.slug).toBe(p.look);
  });

  it("non-software briefs are untouched", () => {
    expect(pickProductPersonality("A wig salon in Lagos", "x")).toBeNull();
    expect(resolvePackageForIntent("hospital patient dashboard", { seed: "x" })!.pkg.meta.slug).toBe("haven");
  });
});
