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
