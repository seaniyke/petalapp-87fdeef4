import { describe, it, expect } from "vitest";
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
  it("plan names every page (no shell-only instruction)", () => {
    const p = planFirstBuild({ prompt: "Pages: Home, Menu, About, Contact only.", plannedRoutes: [], maxOutputTokens: 10000 });
    expect(p.pages.map((x) => x.file)).toEqual(["src/pages/Home.tsx", "src/pages/Menu.tsx", "src/pages/About.tsx", "src/pages/Contact.tsx"]);
    expect("instruction" in p).toBe(false);
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
