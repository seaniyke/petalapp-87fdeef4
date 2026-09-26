import { describe, expect, it } from "vitest";
import { deriveIntentContract, divergentPages, stripRoutesFromRouter, applyIntentContract } from "@/server/prd/intent-contract";
import { findMissingNodes, resolveMissingNodes, exportsSatisfy } from "@/server/engine/missing-nodes";
import { sharedModules, projectContract } from "@/server/engine/write";
import { deterministicPrd } from "@/server/prd/prd-deterministic";

const HOSPITAL = "Build a compliant hospital management system";

describe("intent contract", () => {
  it("recognises a hospital system and excludes commerce", () => {
    const c = deriveIntentContract(HOSPITAL);
    expect(c.archetype).toBe("healthcare");
    expect(c.pages.map((p) => p.route)).toEqual(expect.arrayContaining(["/patients", "/doctors", "/appointments", "/records", "/prescriptions", "/billing"]));
    expect(c.commerceRequested).toBe(false);
    expect(c.exclusions).toContain("checkout");
  });

  it("flags shop pages as divergent for a hospital request", () => {
    const c = deriveIntentContract(HOSPITAL);
    expect(divergentPages(c, ["/products", "/shop", "/cart", "/checkout", "/orders", "/patients"], HOSPITAL).sort()).toEqual(["/cart", "/checkout", "/orders", "/products", "/shop"]);
  });

  it("keeps commerce pages when the user asked for a store", () => {
    const brief = "Build an online store for handmade candles with cart and checkout";
    const c = deriveIntentContract(brief);
    expect(c.commerceRequested).toBe(true);
    expect(divergentPages(c, ["/shop", "/cart", "/checkout"], brief)).toEqual([]);
  });

  it("enriches a weak PRD into a workflow app with page requirements", () => {
    const prd = applyIntentContract(deterministicPrd(HOSPITAL), HOSPITAL);
    expect(prd.productType).toBe("workflow-app");
    expect(prd.requiredSurfaces).toContain("dashboard");
    expect(prd.requiredSurfaces).not.toContain("checkout");
    expect((prd.requirements ?? []).map((r) => r.description)).toEqual(expect.arrayContaining(["Patients", "Appointments", "Medical Records"]));
    expect(prd.intent?.archetype).toBe("healthcare");
  });

  it("strips divergent pages from a router", () => {
    const app = `import Home from "@/pages/Home";\nimport Shop from "@/pages/Shop";\nexport default function App(){return (<Routes>\n<Route path="/" element={<Home />} />\n<Route path="/shop" element={<Shop />} />\n</Routes>);}\n`;
    const out = stripRoutesFromRouter(app, ["src/pages/Shop.tsx"])!;
    expect(out).not.toMatch(/Shop/);
    expect(out).toMatch(/Home/);
  });
});

describe("missing-node recovery", () => {
  const files = [
    { path: "src/pages/Patients.tsx", content: `import { usePatients } from "@/hooks/useData";\nimport { useAuth } from "@/lib/auth-context";\nexport default function P(){ const p = usePatients(); const { user } = useAuth(); return null; }` },
    { path: "src/pages/Doctors.tsx", content: `import { useDoctors, usePatients } from "@/hooks/useData";\nexport default function D(){ return null; }` },
    { path: "src/pages/Home.tsx", content: `import { Button } from "@/components/ui/button";\nexport default function H(){ return null; }` },
  ];

  it("groups importers per missing module (one node per target)", () => {
    const nodes = findMissingNodes(files, files.map((f) => f.path));
    const targets = nodes.map((n) => n.target).sort();
    expect(targets).toEqual(["src/hooks/useData.ts", "src/lib/auth-context.tsx"]);
    const data = nodes.find((n) => n.target === "src/hooks/useData.ts")!;
    expect(data.importers.map((i) => i.path).sort()).toEqual(["src/pages/Doctors.tsx", "src/pages/Patients.tsx"]);
  });

  it("creates each missing module once and rejects incomplete exports", async () => {
    let calls = 0;
    const r = await resolveMissingNodes(files, files.map((f) => f.path), async (node) => {
      calls++;
      if (node.target.includes("useData")) return "export function usePatients(){return []}\nexport function useDoctors(){return []}\n";
      return "export function useAuth(){return {user:null}}\n"; // missing nothing
    });
    expect(calls).toBe(2);
    expect(r.created.sort()).toEqual(["src/hooks/useData.ts", "src/lib/auth-context.tsx"]);
    expect(r.blocked).toEqual([]);
  });

  it("reports a blocker when the created module lacks exports", () => {
    const [node] = findMissingNodes([files[1]!], [files[1]!.path]);
    expect(exportsSatisfy("export function useDoctors(){}", node!)).toEqual(["usePatients"]);
  });
});

describe("foundation contract", () => {
  it("lists shared modules and their exports for page writers", () => {
    const f = [{ path: "src/lib/data.ts", content: "export const patients = [];\nexport function usePatients(){}" }, { path: "package.json", content: "{}" }];
    expect(sharedModules(f)).toEqual([{ path: "src/lib/data.ts", exports: ["patients", "usePatients"] }]);
    expect(projectContract(f)).toMatch(/@\/lib\/data: patients, usePatients/);
  });
});

describe("template drift", () => {
  it("drops clinic-booking template pages for a hospital system but keeps account pages", () => {
    const c = deriveIntentContract(HOSPITAL);
    expect(divergentPages(c, ["/", "/services", "/confirmation", "/book", "/patients", "/auth", "/dashboard"], HOSPITAL).sort()).toEqual(["/book", "/confirmation", "/services"]);
  });
  it("keeps a page the user named", () => {
    const brief = "Build a hospital management system with a pharmacy page";
    expect(divergentPages(deriveIntentContract(brief), ["/pharmacy"], brief)).toEqual([]);
  });
});

import { exploreProject, explorersFor } from "@/server/context/explore";
describe("read-only exploration", () => {
  const files = [
    { path: "src/App.tsx", content: `<Route path="/" /><Route path="/patients" />` },
    { path: "src/pages/Patients.tsx", content: `import { usePatients } from "@/lib/data";\nexport default function P(){return null}` },
    { path: "src/types.ts", content: "export interface Patient { id: string }" },
  ];
  it("skips LIGHT tasks and first builds", async () => {
    expect(explorersFor({ cls: "LIGHT", isInitial: false, request: "change headline", fileCount: 9 })).toEqual([]);
    expect((await exploreProject({ files, cls: "STANDARD", isInitial: true, request: "x" })).ran).toBe(false);
  });
  it("runs bounded explorers and never mutates the project", async () => {
    const before = JSON.stringify(files);
    const r = await exploreProject({ files, cls: "HEAVY", isInitial: false, request: "add a billing module" });
    expect(r.roles).toEqual(["structure", "dependency", "data", "design"]);
    expect(r.block).toMatch(/MISSING shared module src\/lib\/data\.ts/);
    expect(r.block).toMatch(/entities: Patient/);
    expect(JSON.stringify(files)).toBe(before);
  });
});

import { checkUndefinedIdentifiers, isPlatformGlobal } from "@/server/verification/identifiers.server";
describe("identifier gate never flags platform globals", () => {
  it("treats Date/Math/JSON/Intl/HTMLDialogElement as defined", () => {
    for (const n of ["Date", "Math", "JSON", "Intl", "Array", "Promise", "HTMLDialogElement", "matchMedia"]) expect(isPlatformGlobal(n)).toBe(true);
    expect(isPlatformGlobal("mode")).toBe(false);
  });
  it("passes real code using Date and still fails a truly undefined name", () => {
    const ok = checkUndefinedIdentifiers([{ path: "src/a.tsx", content: "export const d = new Date(Date.now()).getTime() + Math.max(1, JSON.parse('2'));" }], ["src/a.tsx"]);
    expect(ok.status).toBe("verified");
    const bad = checkUndefinedIdentifiers([{ path: "src/b.tsx", content: "export const x = mode + 1;" }], ["src/b.tsx"]);
    expect(bad.status).toBe("failed");
  });
});

import { stripRoutesFromRouter as stripR } from "@/server/prd/intent-contract";
describe("router cleanup handles relative page imports", () => {
  it("removes ./pages/Settings import and route", () => {
    const app = `import Home from "./pages/Home";\nimport Settings from "./pages/Settings";\nexport default () => (<Routes>\n<Route path="/" element={<Home />} />\n<Route path="/settings" element={<Settings />} />\n</Routes>);`;
    const out = stripR(app, ["src/pages/Settings.tsx"])!;
    expect(out).not.toMatch(/Settings/);
    expect(out).toMatch(/Home/);
  });
});

import { usedAsValue } from "@/server/local-verifier";
describe("usedAsValue", () => {
  it("type-only uses are not values", () => {
    const src = `import { BakeryInfo, TeamMember } from "@/types";\nexport const info: BakeryInfo = { name: "x" };\nexport const team: TeamMember[] = [];\nfunction f(a: Array<TeamMember>): BakeryInfo | null { return null }`;
    expect(usedAsValue(src, "BakeryInfo")).toBe(false);
    expect(usedAsValue(src, "TeamMember")).toBe(false);
  });
  it("value uses are values", () => {
    expect(usedAsValue(`const a = new Foo();`, "Foo")).toBe(true);
    expect(usedAsValue(`const a = Foo.x;`, "Foo")).toBe(true);
    expect(usedAsValue(`return <Foo />`, "Foo")).toBe(true);
    expect(usedAsValue(`const b = Foo;`, "Foo")).toBe(true);
  });
});
