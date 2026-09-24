import { describe, expect, it } from "vitest";
import {
  buildGenerationUnits,
  estimateFirstBuildSize,
  OUTPUT_CEILING,
  planUnits,
  SAFE_UNIT_BUDGET,
} from "@/server/requested-scope";
import { mergeChunk, runChunkedGeneration } from "@/server/chunked-generation.server";

const page = (path: string, content = "x") => ({ path, content });

describe("first-build generation sizing", () => {
  it("A: one simple page → one unit", () => {
    const u = buildGenerationUnits("A landing page for a yoga studio", []);
    expect(u.unitCount).toBe(1);
    expect(u.instruction).toBe("");
  });

  it("B: two simple pages → one unit (under the safe budget)", () => {
    const u = buildGenerationUnits("A bakery site with Home and Menu pages", []);
    expect(u.unitCount).toBe(1);
    expect(u.estimate.total).toBeLessThanOrEqual(SAFE_UNIT_BUDGET);
  });

  it("C: the Rise & Crumb four-page site → two coherent units, not four", () => {
    const u = buildGenerationUnits(
      "Build a bakery website for Rise & Crumb with Home, Menu, About and Contact pages. Make it polished, responsive, modern and warm.",
      [],
    );
    expect(u.estimate.kind).toBe("marketing");
    expect(u.unitCount).toBe(2);
    expect(u.units[0]!.routes).toEqual(["/", "/menu"]);
    expect(u.units[1]!.routes).toEqual(["/about", "/contact"]);
    // Scope stays exactly what was asked for.
    expect(u.allRoutes.sort()).toEqual(["/", "/about", "/contact", "/menu"]);
  });

  it("D: a complex two-page app can split despite the low page count", () => {
    const u = buildGenerationUnits(
      "A CRM with login and a database: Dashboard and Contacts pages with upload, search, filter, chart and export",
      [],
    );
    expect(u.estimate.kind).toBe("app");
    expect(u.unitCount).toBeGreaterThan(1);
  });

  it("G: no planned unit comes near the output ceiling", () => {
    for (const prompt of [
      "pages: Home, Menu, About, Contact, Blog, Careers, FAQ, Press, Team",
      "An inventory tracker: Dashboard, Items, Suppliers, Orders, Reports pages",
    ]) {
      const u = buildGenerationUnits(prompt, []);
      for (const unit of u.units) {
        expect(unit.estimatedTokens).toBeLessThanOrEqual(SAFE_UNIT_BUDGET);
        expect(unit.estimatedTokens).toBeLessThan(OUTPUT_CEILING * 0.65);
      }
    }
  });

  it("packs greedily — never one page per unit when two fit", () => {
    const est = estimateFirstBuildSize("pages", ["/", "/a", "/b", "/c", "/d", "/e"]);
    const units = planUnits(est);
    expect(units.length).toBeLessThan(est.pages.length);
  });
});

describe("later units build only what is left", () => {
  it("E: a later unit never overwrites a completed page, but may wire the router", () => {
    const base = { ops: [], files: [page("src/pages/Home.tsx", "HOME"), page("src/App.tsx", "v1")] };
    const out = mergeChunk(base, {
      files: [page("src/pages/Home.tsx", "REWRITE"), page("src/App.tsx", "v2"), page("src/pages/About.tsx")],
    });
    expect(out.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe("HOME");
    expect(out.files.find((f) => f.path === "src/App.tsx")!.content).toBe("v2");
    expect(out.files.some((f) => f.path === "src/pages/About.tsx")).toBe(true);
  });

  it("F: a failing later unit leaves unit 1 intact", async () => {
    const files = [page("src/pages/Home.tsx", "HOME"), page("src/pages/Menu.tsx", "MENU")];
    const res = await runChunkedGeneration({
      isInitial: true,
      assessment: {
        needed: true,
        reason: "coverage_incomplete",
        deliveredPaths: files.map((f) => f.path),
        remainingSteps: ["Create /about", "Create /contact"],
      } as never,
      ops: [],
      files,
      request: async () => {
        throw new Error("provider down");
      },
    });
    expect(res.added).toBe(0);
    expect(res.files.map((f) => f.content)).toEqual(["HOME", "MENU"]);
  });
});
