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

  it("writes each missing page in its own call and never rewrites finished pages", async () => {
    const instrs: string[] = [];
    const r = await generateMissingPages({
      requestedRoutes: requested,
      files: partial,
      budget: new RecoveryBudget(),
      request: async (i) => {
        instrs.push(i);
        if (i.includes("ONLY src/App.tsx")) return [app(requested)];
        if (i.includes("src/pages/Menu.tsx")) return [{ path: "src/pages/Menu.tsx", content: "export default function Menu(){return <main><h1>Menu</h1><p>Sourdough, croissants and seasonal pastries baked daily.</p></main>}" }, { path: "src/pages/Home.tsx", content: "REWRITTEN" }];
        if (i.includes("src/pages/About.tsx")) return [{ path: "src/pages/About.tsx", content: "export default function About(){return <main><h1>About</h1><p>A family bakery rising before dawn since 2009.</p></main>}" }];
        return null;
      },
    });
    expect(instrs.filter((i) => i.includes("Write ONLY the page")).length).toBe(2);
    expect(r.missingAfter).toEqual([]);
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe("home");
  });

  it("each page is attempted once only; still-missing pages are reported", async () => {
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

import { extractRequestedPages } from "@/server/requested-scope";
describe("requested page names", () => {
  it('"Pages: Home, Menu, About, Contact only" is exactly four pages', () => {
    expect(extractRequestedPages("Pages: Home, Menu, About, Contact only. Responsive.")).toEqual(["home", "menu", "about", "contact"]);
  });
});
