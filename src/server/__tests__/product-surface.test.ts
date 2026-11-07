import { describe, expect, it } from "vitest";
import { deriveIntentContract, renderIntentBlock, divergentPages } from "@/server/prd/intent-contract";
import { conditionalSkills } from "@/server/engine/first-build-context";
import { responsiveWarnings } from "@/server/verification/responsive";

const c = (b: string) => deriveIntentContract(b);

describe("product surface", () => {
  it("hospital / school / restaurant systems get a public site + app", () => {
    for (const b of ["Build me a hospital management system.", "Build me a school management system.", "Build me a restaurant management system."]) {
      const k = c(b);
      expect(k.surface).toBe("public+app");
      expect(k.pages[0]!.route).toBe("/");
      expect(k.pages.map((p) => p.route)).toContain("/login");
      expect(k.pages.map((p) => p.route)).toContain("/dashboard");
    }
  });
  it("SaaS platform gets both surfaces", () => expect(c("Build me a SaaS platform.").surface).toBe("public+app"));
  it("marketing website stays a website with no app pages", () => {
    const k = c("Build me a marketing website for a hospital.");
    expect(k.surface).toBe("public");
    expect(k.productType).toBeNull();
    expect(k.pages).toEqual([]);
    expect(divergentPages(k, ["/", "/services", "/contact"], "marketing website for a hospital")).toEqual([]);
  });
  it("internal dashboard stays an app with the dashboard at /", () => {
    const k = c("Build me an internal hospital dashboard.");
    expect(k.surface).toBe("app");
    expect(k.pages[0]).toEqual({ route: "/", label: "Dashboard" });
  });
  it("staff-only domains stay apps", () => expect(c("Build an HR management system").surface).toBe("app"));
  it("plain restaurant/bakery websites are not turned into apps", () => {
    expect(c("Build a website for Mario's restaurant").archetype).toBeNull();
    expect(c("Build a bakery website").productType).toBeNull();
  });
  it("contract block explains the two layouts", () => {
    expect(renderIntentBlock(c("Build me a hospital management system."))).toMatch(/TWO surfaces/);
  });
  it("contracts stored before the field existed still render", () => {
    const k = { ...c("Build an HR management system") } as Record<string, unknown>;
    delete k.surface;
    expect(renderIntentBlock(k as never)).toMatch(/Product contract/);
  });
});

describe("page-composition skill", () => {
  it("unchanged for existing subtypes", () => {
    expect(conditionalSkills("marketing")).toEqual(["page-composition"]);
    expect(conditionalSkills("app")).toEqual([]);
  });
  it("loaded for an app whose product also has a public site", () => {
    expect(conditionalSkills("app", "public+app")).toEqual(["page-composition"]);
    expect(conditionalSkills("app", "app")).toEqual([]);
  });
});

describe("responsive advisories (non-blocking)", () => {
  const w = (content: string) => responsiveWarnings([{ path: "src/pages/X.tsx", content }], ["src/pages/X.tsx"]);
  it("responsive table is clean", () => expect(w(`<div className="overflow-x-auto"><table className="w-full"></table></div>`)).toEqual([]));
  it("kit table is clean", () => expect(w(`import { Table } from "@/components/ui/table";\n<Table />`)).toEqual([]));
  it("bare wide table is flagged", () => expect(w(`<div><table className="min-w-[900px]"></table></div>`).some((x) => x.rule === "table-no-scroll")).toBe(true));
  it("normal modal is clean", () => expect(w(`<div className="w-full max-w-lg sm:w-[560px] rounded-lg">Modal</div>`)).toEqual([]));
  it("modal with max-width escape is clean", () => expect(w(`<div className="w-[600px] max-w-full">Modal</div>`)).toEqual([]));
  it("oversized fixed width is flagged", () => expect(w(`<aside className="w-[720px]">x</aside>`)[0]!.rule).toBe("fixed-width-over-mobile"));
  it("unchanged files are ignored", () => expect(responsiveWarnings([{ path: "a.tsx", content: "<table>" }], [])).toEqual([]));
});

describe("negated app words (Aura live run, 7 Nov 2026)", () => {
  const aura = "Build a website for Aura, an architectural lighting design studio. Pages: Home, Services, Projects (portfolio with category filter), Contact (inquiry form and studio details). Website only, no accounts.";
  it("'Website only, no accounts' is a public website, not an app", () => {
    expect(deriveIntentContract(aura).surface).toBe("public");
  });
  it("'without login' does not ask for sign-in", () => {
    expect(deriveIntentContract("A bakery website without login").surface).toBe("public");
  });
  it("a real request for accounts is still an app", () => {
    expect(deriveIntentContract("A task app where users sign in to their accounts").surface).not.toBe("public");
  });
});
