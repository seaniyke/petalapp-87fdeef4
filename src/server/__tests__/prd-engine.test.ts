import { describe, expect, it } from "vitest";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { mergePrd } from "@/server/prd/prd-model.server";
import { amendPrd } from "@/server/prd/prd-amend";
import { checkPrdStatically, prdBrowserScenarios } from "@/server/prd/prd-acceptance.server";

const PREGNANCY = "build a female pregnancy calculator";

describe("deterministic PRD", () => {
  it("classifies a calculator as a public utility, not a dashboard", () => {
    const prd = deterministicPrd(PREGNANCY);
    expect(prd.productType).toBe("utility");
    expect(prd.requiredSurfaces).toContain("tool");
    expect(prd.excludedSurfaces).toContain("dashboard");
    expect(prd.needsAuth).toBe(false);
  });

  it("supplies real domain logic instead of an empty spec", () => {
    const prd = deterministicPrd(PREGNANCY);
    expect(prd.formulas.length).toBeGreaterThan(0);
    expect(prd.formulas[0].example).toBeDefined();
  });

  it("always produces a five-step primary workflow", () => {
    for (const brief of [PREGNANCY, "a blog about coffee", "marketplace for used bikes"]) {
      expect(deterministicPrd(brief).primaryWorkflow.steps).toHaveLength(5);
    }
  });
});

describe("mergePrd", () => {
  it("keeps deterministic formulas even when the model omits them", () => {
    const prior = deterministicPrd(PREGNANCY);
    const merged = mergePrd(prior, { productName: "Due Date Companion", formulas: [] });
    expect(merged.formulas).toHaveLength(prior.formulas.length);
    expect(merged.productName).toBe("Due Date Companion");
  });

  it("rejects a category name in favour of the prior brand name", () => {
    const prior = deterministicPrd(PREGNANCY);
    const merged = mergePrd(prior, { productName: "Pregnancy Calculator" });
    expect(merged.productName).toBe(prior.productName);
  });

  it("never lets the model empty the required surfaces", () => {
    const prior = deterministicPrd(PREGNANCY);
    const merged = mergePrd(prior, { requiredSurfaces: [] });
    expect(merged.requiredSurfaces).toEqual(prior.requiredSurfaces);
  });
});

describe("amendPrd", () => {
  const base = deterministicPrd(PREGNANCY);

  it("leaves the contract untouched for cosmetic edits", () => {
    const out = amendPrd(base, "make the button colour blue and increase the font size");
    expect(out.kind).toBe("cosmetic");
    expect(out.changed).toBe(false);
  });

  it("treats a new surface as an additive amendment", () => {
    const out = amendPrd(base, "add a blog with pregnancy guides");
    expect(out.kind).toBe("additive");
    expect(out.prd.requiredSurfaces).toContain("content");
  });

  it("lets newer intent override an earlier exclusion", () => {
    const out = amendPrd(base, "I want users to sign in and save their results");
    expect(out.kind).toBe("contradiction");
    expect(out.prd.requiredSurfaces).toContain("auth");
    expect(out.prd.excludedSurfaces).not.toContain("auth");
    expect(out.prd.needsAuth).toBe(true);
    expect(out.prd.needsPersistence).toBe(true);
  });

  it("records removals as exclusions with an absence criterion", () => {
    const added = amendPrd(base, "add a dashboard").prd;
    const out = amendPrd(added, "remove the dashboard");
    expect(out.prd.requiredSurfaces).not.toContain("dashboard");
    expect(out.prd.excludedSurfaces).toContain("dashboard");
    expect(out.prd.acceptance.some((c) => c.id === "no-dashboard")).toBe(true);
  });
});

describe("PRD acceptance gate", () => {
  const prd = deterministicPrd(PREGNANCY);

  it("fails the exact build that shipped a dashboard for a calculator", () => {
    const files = [
      {
        path: "src/routes/dashboard.tsx",
        content: "export default function D(){return <SidebarProvider><Sidebar/></SidebarProvider>}",
      },
      { path: "src/routes/index.tsx", content: "export default function I(){return <div>hi</div>}" },
    ];
    const result = checkPrdStatically(prd, files);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.criterionId === "no-dashboard")).toBe(true);
    expect(result.findings.some((f) => f.criterionId === "primary-action-visible")).toBe(true);
  });

  it("flags a missing calculation module", () => {
    const files = [
      { path: "src/routes/index.tsx", content: "export default function I(){return <form>calculator</form>}" },
    ];
    const result = checkPrdStatically(prd, files);
    expect(result.findings.some((f) => f.criterionId.startsWith("formula-"))).toBe(true);
  });

  it("passes a correctly shaped utility build", () => {
    const files = [
      {
        path: "src/lib/pregnancy.ts",
        content: "export function dueDate(lmp: Date){ return new Date(lmp.getTime() + 280 * 86400000); }",
      },
      {
        path: "src/routes/index.tsx",
        content: "export default function I(){ return <main><form>calculator</form><section>result</section></main> }",
      },
    ];
    expect(checkPrdStatically(prd, files).passed).toBe(true);
  });

  it("derives browser scenarios including a mobile pass and the worked example", () => {
    const scenarios = prdBrowserScenarios(prd);
    expect(scenarios.some((s) => s.viewport === "mobile")).toBe(true);
    expect(scenarios.some((s) => s.criterionId.startsWith("formula-"))).toBe(true);
  });
});
