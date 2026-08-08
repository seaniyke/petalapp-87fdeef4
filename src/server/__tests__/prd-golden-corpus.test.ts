/**
 * Phase 5 — golden regression corpus.
 *
 * Ten structurally different prompts. Each asserts the PRD shape Petal must
 * derive BEFORE it writes a file: product type, required surfaces, forbidden
 * surfaces, and whether the product's value is a computation.
 *
 * These run against the deterministic pass only (no network), because the
 * deterministic pass is the floor: whatever the model adds, it may not drop
 * below these guarantees.
 */

import { describe, it, expect } from "vitest";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { subtypeFromPrd, filterTemplateRoutes, excludedSurfaceForPath } from "@/server/prd/prd-reconcile";
import { checkPrdStatically, prdBrowserScenarios } from "@/server/prd/prd-acceptance.server";

interface Golden {
  name: string;
  prompt: string;
  /** Surfaces that must appear in requiredSurfaces. */
  mustHave: string[];
  /** Surfaces that must never be built. */
  mustNotHave?: string[];
  subtype?: "marketing" | "app" | "fullstack" | "tool";
  computation?: boolean;
}

const CORPUS: Golden[] = [
  {
    name: "pregnancy calculator",
    prompt: "build a female pregnancy calculator",
    mustHave: ["landing", "tool", "results"],
    mustNotHave: ["dashboard", "admin", "auth"],
    subtype: "tool",
    computation: true,
  },
  {
    name: "mortgage calculator",
    prompt: "a mortgage repayment calculator for first-time buyers",
    mustHave: ["landing", "tool", "results"],
    mustNotHave: ["dashboard", "admin"],
    computation: true,
  },
  {
    name: "restaurant site with booking",
    prompt: "a website for my italian restaurant with a table booking form",
    mustHave: ["landing"],
    mustNotHave: ["admin"],
  },
  {
    name: "task manager",
    prompt: "a task manager app where users sign in and manage their projects and tasks",
    mustHave: ["dashboard", "auth"],
  },
  {
    name: "marketplace",
    prompt: "a marketplace where photographers list gear for rent and renters book it",
    mustHave: ["catalog", "detail"],
  },
  {
    name: "ai chat tool",
    prompt: "an AI chat tool that answers questions about uploaded PDFs",
    mustHave: ["tool"],
  },
  {
    name: "portfolio",
    prompt: "a personal portfolio site for a product designer",
    mustHave: ["landing"],
    mustNotHave: ["dashboard", "auth", "admin"],
    subtype: "marketing",
  },
  {
    name: "internal admin tool",
    prompt: "an internal admin tool for our support team to manage refunds and customers",
    mustHave: ["dashboard"],
  },
  {
    name: "habit tracker",
    prompt: "a habit tracker where I check off daily habits and see my streaks",
    mustHave: [],
  },
  {
    name: "saas with landing plus app",
    prompt: "a SaaS invoicing product with a marketing landing page and a signed-in dashboard for invoices",
    mustHave: ["landing", "dashboard", "auth"],
  },
];

describe("PRD golden corpus", () => {
  for (const g of CORPUS) {
    describe(g.name, () => {
      const prd = deterministicPrd(g.prompt);

      it("names a real product and a primary workflow", () => {
        expect(prd.productName.trim().length).toBeGreaterThan(0);
        expect(prd.productName.toLowerCase()).not.toBe("my app");
        expect(prd.primaryWorkflow.steps.length).toBeGreaterThan(1);
      });

      it("requires the surfaces this product cannot exist without", () => {
        for (const s of g.mustHave) expect(prd.requiredSurfaces).toContain(s);
      });

      it("never invents the surfaces this product must not have", () => {
        for (const s of g.mustNotHave ?? []) {
          expect(prd.requiredSurfaces).not.toContain(s);
          expect(prd.excludedSurfaces).toContain(s);
        }
      });

      if (g.subtype) {
        it(`routes to the ${g.subtype} shape`, () => {
          expect(subtypeFromPrd(prd)).toBe(g.subtype);
        });
      }

      if (g.computation) {
        it("states its domain logic as real formulas", () => {
          expect(prd.formulas.length).toBeGreaterThan(0);
        });

        it("fails the static gate when no calculation module was emitted", () => {
          const result = checkPrdStatically(prd, [
            { path: "src/routes/index.tsx", content: "export default function Home(){return <div>Hi</div>}" },
          ]);
          expect(result.passed).toBe(false);
        });
      }

      it("produces at least one browser acceptance scenario", () => {
        expect(prdBrowserScenarios(prd).length).toBeGreaterThan(0);
      });

      it("strips excluded surfaces from template routes and file paths", () => {
        const kept = filterTemplateRoutes(prd, ["/", "/auth/sign-in", "/dashboard", "/admin"]);
        expect(kept).toContain("/");
        for (const s of g.mustNotHave ?? []) {
          if (s === "auth") expect(kept).not.toContain("/auth/sign-in");
          if (s === "dashboard") expect(kept).not.toContain("/dashboard");
          if (s === "admin") expect(kept).not.toContain("/admin");
        }
        if ((g.mustNotHave ?? []).includes("dashboard")) {
          expect(excludedSurfaceForPath(prd, "src/routes/dashboard.tsx")).toBe("dashboard");
        }
        expect(excludedSurfaceForPath(prd, "src/routes/index.tsx")).toBeNull();
      });
    });
  }
});
