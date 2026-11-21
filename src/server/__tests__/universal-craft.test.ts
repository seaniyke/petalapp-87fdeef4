import { describe, expect, it } from "vitest";
import { KIT_FILES } from "@/server/scaffold-kit";
import { renderDesignSystemContext } from "@/server/design-systems/context";
import { getDesignSystem } from "@/server/design-systems/registry";
import { renderDesignTasteBlock } from "@/server/design-taste.server";
const DESIGN_TASTE_GUIDE = renderDesignTasteBlock("a bakery").text;

describe("universal craft architecture", () => {
  it("ships the fluid experience primitives to every app", () => {
    const paths = KIT_FILES.map((f) => f.path);
    for (const p of ["surface", "choice-grid", "step-flow", "disclosure"]) {
      expect(paths).toContain(`src/components/flow/${p}.tsx`);
    }
  });

  it("appends the same craft baseline to every style package", () => {
    for (const slug of ["atelier", "obsidian", "monolith", "bloom", "haven", "kinetic"]) {
      const pkg = getDesignSystem(slug)!;
      const ctx = renderDesignSystemContext(pkg, pkg.meta.default_accent);
      expect(ctx).toContain("Universal craft baseline");
      expect(ctx).toContain("<Disclosure>");
    }
  });

  it("hierarchy rule is universal, not tied to one industry", () => {
    expect(DESIGN_TASTE_GUIDE).toMatch(/Information hierarchy is universal/);
    expect(DESIGN_TASTE_GUIDE).not.toMatch(/salons, beauty, food/);
  });
});
