import { describe, expect, it } from "vitest";
import { deterministicUnderstanding, renderUnderstandingBlock } from "@/server/understanding.server";
import {
  deterministicDesignSystem,
  designSystemFromDirection,
  renderDesignSystemBlock,
  renderDesignTokensCss,
} from "@/server/design/design-system.server";
import { fallbackDesignDirection } from "@/server/design-director.server";
import {
  lintDesignSystem,
  renderDesignLintFeedback,
} from "@/server/design/design-system-lint.server";
import { renderPicBlock } from "@/server/pic/pic-render";
import type { ProjectIntelligenceContext } from "@/server/pic/pic-types";

const PORTAL = "A portal where parents pay school fees and see their child's results";

describe("semantic understanding (deterministic floor)", () => {
  it("reads payments and auth out of a fee-payment portal", () => {
    const u = deterministicUnderstanding(PORTAL);
    expect(u.needsPayments).toBe(true);
    expect(u.needsAuth).toBe(true);
    expect(u.needsDatabase).toBe(true);
    expect(u.source).toBe("deterministic");
  });

  it("keeps a single-purpose tool frontend-only", () => {
    const u = deterministicUnderstanding("a pregnancy due date calculator");
    expect(u.needsPayments).toBe(false);
    expect(u.needsBackend).toBe(false);
  });

  it("renders a compact prompt block", () => {
    const block = renderUnderstandingBlock(deterministicUnderstanding(PORTAL));
    expect(block).toContain("WHAT YOU ARE BUILDING");
    expect(block).toContain("payments");
  });
});

describe("design system contract", () => {
  const u = deterministicUnderstanding(PORTAL);
  const ds = deterministicDesignSystem(PORTAL, u, { seed: "proj-1" });

  it("commits every semantic colour role", () => {
    for (const role of ["background", "foreground", "primary", "mutedForeground", "border"] as const) {
      expect(ds.colors[role].light).toMatch(/oklch|#|hsl/);
      expect(ds.colors[role].dark).toBeTruthy();
    }
  });

  it("is stable for the same seed and product", () => {
    const again = deterministicDesignSystem(PORTAL, u, { seed: "proj-1" });
    expect(again.colors.primary.light).toBe(ds.colors.primary.light);
  });

  it("emits :root and .dark token blocks", () => {
    const css = renderDesignTokensCss(ds);
    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    expect(css).toContain("--muted-foreground");
  });

  it("renders an enforceable prompt block", () => {
    const block = renderDesignSystemBlock(ds);
    expect(block).toContain("DESIGN SYSTEM CONTRACT");
    expect(block).toContain(ds.typography.displayFont);
    expect(block).toContain("Empty states:");
  });

  it("derives the canonical contract from the director instead of voting again", () => {
    const direction = fallbackDesignDirection("premium restaurant with reservations", "restaurant-1");
    const committed = designSystemFromDirection(PORTAL, u, direction, "restaurant-1");
    expect(committed.direction).toBe(direction.vibe);
    expect(committed.typography.displayFont).toBe(direction.display_font);
    expect(committed.typography.bodyFont).toBe(direction.body_font);
    expect(committed.imagery).toContain(direction.design_moves[0]);
  });

  it("uses category-specific fallback composition instead of generic cards", () => {
    const restaurant = fallbackDesignDirection("premium restaurant reservations", "r1");
    const fintech = fallbackDesignDirection("fintech banking dashboard", "f1");
    expect(restaurant.design_moves.join(" ")).toMatch(/food|venue|menu/i);
    expect(fintech.design_moves.join(" ")).toMatch(/balance|transaction|KPI/i);
    expect(fintech.density).toBe("dense");
  });
});

describe("design system lint", () => {
  const u = deterministicUnderstanding(PORTAL);
  const ds = deterministicDesignSystem(PORTAL, u, { seed: "proj-1" });

  it("flags raw colour utilities and hex values", () => {
    const report = lintDesignSystem(
      [{ path: "src/pages/Home.tsx", content: `export const A = () => <div className="bg-white text-gray-500" style={{ color: "#ff0000" }} />;` }],
      ds,
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "color/raw-utility")).toBe(true);
    expect(report.findings.some((f) => f.rule === "color/hardcoded-hex")).toBe(true);
    expect(renderDesignLintFeedback(report)).toContain("DESIGN CONTRACT VIOLATIONS");
  });

  it("passes token-based markup", () => {
    const report = lintDesignSystem(
      [
        {
          path: "src/pages/Home.tsx",
          content: `export const A = () => <div className="bg-background text-muted-foreground border-border" />;`,
        },
      ],
      ds,
    );
    expect(report.errorCount).toBe(0);
  });

  it("ignores kit-owned files", () => {
    const report = lintDesignSystem(
      [{ path: "src/components/ui/button.tsx", content: `<div className="bg-white" />` }],
      ds,
    );
    expect(report.errorCount).toBe(0);
  });

  it("is a no-op without a committed contract", () => {
    const report = lintDesignSystem([{ path: "src/a.tsx", content: `<div className="bg-white" />` }], null);
    expect(report.ok).toBe(true);
  });
});

describe("PIC rendering", () => {
  const u = deterministicUnderstanding(PORTAL);
  const pic: ProjectIntelligenceContext = {
    schema: 1,
    projectId: "p1",
    productVision: u.summary,
    understanding: u,
    prd: null,
    userJourneys: ["Parent signs in, opens fees, pays, sees a receipt"],
    features: ["fee payment", "results view"],
    uxDecisions: [],
    design: deterministicDesignSystem(PORTAL, u, { seed: "p1" }),
    architecture: null,
    security: null,
    acceptanceCriteria: ["A parent can pay a fee and see a receipt"],
    decisions: [],
    protectedDecisions: ["Never change the payment provider"],
    protectedFiles: ["src/lib/payments.ts"],
    unresolved: [],
    history: [],
    updatedAt: new Date().toISOString(),
    revision: 1,
  };

  it("renders the full contract on structural turns", () => {
    const block = renderPicBlock(pic, { detail: "full" });
    expect(block).toContain("PROJECT INTELLIGENCE CONTEXT");
    expect(block).toContain("DESIGN SYSTEM CONTRACT");
    expect(block).toContain("PROTECTED FILES");
  });

  it("renders a short block on small edits", () => {
    const full = renderPicBlock(pic, { detail: "full" });
    const summary = renderPicBlock(pic, { detail: "summary" });
    expect(summary.length).toBeLessThan(full.length);
    expect(summary).toContain("LOCKED DECISIONS");
  });
});
