import { describe, it, expect } from "vitest";
import { generateMissingPages, missingPagesInstruction } from "@/server/engine/completeness";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { resolveProviderRouting } from "@/server/engine/provider-policy";

const app = (routes: string[]) => ({
  path: "src/App.tsx",
  content: routes.map((r) => `<Route path="${r}" />`).join("\n"),
});

describe("completeness stage", () => {
  const requested = ["/", "/menu", "/about", "/contact"];
  const partial = [app(["/", "/contact"]), { path: "src/pages/Home.tsx", content: "home" }, { path: "src/pages/Contact.tsx", content: "c" }];

  it("asks for ALL missing pages in one call and never rewrites finished pages", async () => {
    let calls = 0;
    let instr = "";
    const r = await generateMissingPages({
      requestedRoutes: requested,
      files: partial,
      budget: new RecoveryBudget(),
      request: async (i) => {
        calls++;
        instr = i;
        return [
          app(["/", "/menu", "/about", "/contact"]),
          { path: "src/pages/Menu.tsx", content: "m" },
          { path: "src/pages/About.tsx", content: "a" },
          { path: "src/pages/Home.tsx", content: "REWRITTEN" },
        ];
      },
    });
    expect(calls).toBe(1);
    expect(instr).toMatch(/"\/menu"/);
    expect(instr).toMatch(/"\/about"/);
    expect(r.missingAfter).toEqual([]);
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe("home");
  });

  it("is attempted once only; still-missing pages are reported", async () => {
    const budget = new RecoveryBudget();
    const first = await generateMissingPages({ requestedRoutes: requested, files: partial, budget, request: async () => null });
    expect(first.attempted).toBe(true);
    expect(first.missingAfter.length).toBeGreaterThan(0);
    let called = false;
    const second = await generateMissingPages({
      requestedRoutes: requested, files: partial, budget,
      request: async () => { called = true; return null; },
    });
    expect(called).toBe(false);
    expect(second.attempted).toBe(false);
  });

  it("skips when nothing is missing", async () => {
    const full = [app(requested), ...["Home", "Menu", "About", "Contact"].map((n) => ({ path: `src/pages/${n}.tsx`, content: n }))];
    const r = await generateMissingPages({ requestedRoutes: requested, files: full, budget: new RecoveryBudget(), request: async () => { throw new Error("no"); } });
    expect(r.attempted).toBe(false);
  });

  it("instruction names no extra pages", () => {
    expect(missingPagesInstruction(["/menu"], ["src/pages/Home.tsx"])).toMatch(/No extra pages/);
  });
});

describe("single provider authority", () => {
  it("non-code tool calls skip NextBit and still exclude failed upstreams", () => {
    expect(resolveProviderRouting({ codeWriting: false, avoid: ["Azure"], hasTools: true })).toEqual({
      require_parameters: true,
      ignore: ["nextbit", "azure"],
    });
  });
});
