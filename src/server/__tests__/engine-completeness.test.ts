import { describe, it, expect } from "vitest";
import { runAgentLoop as writePlannedPages } from "@/server/engine/agent-loop";
import { planFirstBuild, pageFileFor } from "@/server/engine/plan";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { resolveProviderRouting } from "@/server/engine/provider-policy";

const app = (routes: string[]) => ({
  path: "src/App.tsx",
  content: `<header><nav/></header><Routes>\n${routes.map((r) => `<Route path="${r}" />`).join("\n")}\n</Routes><footer/>`,
});
const requested = ["/", "/menu", "/about", "/contact"];
const pages = requested.map((route) => ({ route, file: pageFileFor(route) }));
const page = (n: string) => ({ path: `src/pages/${n}.tsx`, content: `export default function ${n}(){return <main>${n}</main>}` });

describe("plan drives write", () => {
  it("plan names every page and tells the shell call not to write pages", () => {
    const p = planFirstBuild({ prompt: "Pages: Home, Menu, About, Contact only.", plannedRoutes: [], maxOutputTokens: 10000 });
    expect(p.pages.map((x) => x.file)).toEqual(["src/pages/Home.tsx", "src/pages/Menu.tsx", "src/pages/About.tsx", "src/pages/Contact.tsx"]);
    expect(p.instruction).toMatch(/Do NOT write any of the page files/);
  });
});

describe("write stage", () => {
  it("writes each planned page once, in its own call, never rewriting finished pages", async () => {
    const instrs: string[] = [];
    const r = await writePlannedPages({
      pages,
      files: [app(requested), page("Home")],
      budget: new RecoveryBudget(),
      request: async (i) => {
        instrs.push(i);
        const m = /as src\/pages\/(\w+)\.tsx/.exec(i);
        return m ? [page(m[1]!), { path: "src/pages/Home.tsx", content: "REWRITTEN" }] : null;
      },
    });
    expect(instrs.length).toBe(3);
    expect(r.missing).toEqual([]);
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).not.toBe("REWRITTEN");
  });

  it("a failed page gets exactly one more attempt, then is reported missing", async () => {
    let calls = 0;
    const r = await writePlannedPages({
      pages, files: [app(requested)], budget: new RecoveryBudget(),
      request: async (i) => { calls++; return i.includes("Menu") ? null : [page(/as src\/pages\/(\w+)/.exec(i)?.[1] ?? "X")]; },
    });
    expect(r.missing).toEqual(["/menu"]);
    expect(calls).toBe(5); // 4 pages + 1 retry for Menu (router already fine)
  });

  it("a placeholder page is not a real page", async () => {
    const stub = { path: "src/pages/Home.tsx", content: "// Auto-generated stub by Petal import-resolver.\nexport default ()=>null" };
    const r = await writePlannedPages({
      pages: [pages[0]!], files: [app(["/"]), stub], budget: new RecoveryBudget(),
      request: async () => [page("Home")],
    });
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toContain("<main>Home");
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
