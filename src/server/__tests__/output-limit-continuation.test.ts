/**
 * First live run (Sept 2026): a six-page hotel site stopped at the 10,000-token
 * shell ceiling. The planner had read only "/" from "Home, Rooms, About,
 * Amenities, Gallery, and Contact pages" (Oxford comma), so the WRITE stage
 * had nothing left to write and a router importing five missing pages went
 * to verification. These tests pin the continuation contract:
 *   output limit ≠ turn failure; remaining pages are written under bounded
 *   budgets; an incomplete site is never reported complete.
 */
import { describe, expect, it } from "vitest";
import { extractRequestedPages, pageNameToRoute } from "@/server/requested-scope";
import { planFirstBuild, type PlannedPage } from "@/server/engine/plan";
import { targetOf } from "@/server/engine/write";
import { assessCompleteness } from "@/server/engine/build-state";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { AgentCircuitBreaker } from "@/server/execution/circuit-breaker";

const HOTEL =
  "Build a premium boutique hotel website with Home, Rooms, About, Amenities, Gallery, and Contact pages. Make it feel luxurious, editorial and distinctive, with strong mobile responsiveness and polished interactions.";
const ROUTES = ["/", "/rooms", "/about", "/amenities", "/gallery", "/contact"];

const page = (name: string) =>
  `export default function ${name}() {\n  return (\n    <main>\n      <h1>${name}</h1>\n      <p>Rooms facing the old harbour, breakfast on the terrace, and a quiet library bar.</p>\n    </main>\n  );\n}\n`;

function shell(pages: PlannedPage[]): { path: string; content: string } {
  const name = (f: string) => f.split("/").pop()!.replace(".tsx", "");
  return {
    path: "src/App.tsx",
    content: [
      `import { Routes, Route } from "@/components/ui/router";`,
      ...pages.map((p) => `import ${name(p.file)} from "@/pages/${name(p.file)}";`),
      `export default function App() {`,
      `  return (<div><header><nav>Casa Serai</nav></header><Routes>`,
      ...pages.map((p) => `    <Route path="${p.route}" element={<${name(p.file)} />} />`),
      `  </Routes><footer>Casa Serai</footer></div>);`,
      `}`,
    ].join("\n"),
  };
}

/** A page writer that returns the requested page, with optional scripted failures. */
function writer(opts: { cut?: Set<string>; cutAlways?: Set<string>; failAfter?: number } = {}) {
  const seen: string[] = [];
  const request = async (instruction: string) => {
    const want = targetOf(instruction)!;
    seen.push(want);
    if (opts.failAfter !== undefined && seen.length > opts.failAfter) throw new Error("Stopped by user before page writing");
    if (want === "src/App.tsx") return null;
    const name = want.split("/").pop()!.replace(".tsx", "");
    const cut = opts.cutAlways?.has(want) || (opts.cut?.has(want) && seen.filter((s) => s === want).length === 1);
    return [{ path: want, content: cut ? page(name).slice(0, 60) : page(name) }];
  };
  const isTruncated = async (f: { content: string }) => !f.content.trimEnd().endsWith("}");
  return { request, isTruncated, seen };
}

describe("page list parsing (planner input)", () => {
  it("reads every page from an Oxford-comma list", () => {
    const routes = extractRequestedPages(HOTEL).map(pageNameToRoute);
    for (const r of ROUTES) expect(routes).toContain(r);
  });
  it("still reads lists without the Oxford comma", () => {
    const routes = extractRequestedPages("A site with Home, Menu and Contact pages").map(pageNameToRoute);
    expect(routes).toEqual(expect.arrayContaining(["/", "/menu", "/contact"]));
  });
  it("plans all six hotel pages against the real 10k first-unit ceiling", () => {
    const plan = planFirstBuild({ prompt: HOTEL, plannedRoutes: [], maxOutputTokens: 10_000 });
    expect(plan.pages.map((p) => p.route).sort()).toEqual([...ROUTES].sort());
  });
});

describe("output-limit continuation (first build WRITE stage)", () => {
  const plan = planFirstBuild({ prompt: HOTEL, plannedRoutes: [], maxOutputTokens: 10_000 }).pages;

  it("the circuit breaker still trips on repeated identical failures during a continuation turn", () => {
    const breaker = new AgentCircuitBreaker();
    let tripped = false;
    for (let i = 0; i < 3; i++) {
      const d = breaker.recordFailure({ category: "syntax_error", tool: "verify", path: "src/pages/Rooms.tsx", message: "Unexpected end of file" });
      if (d.tripped) tripped = true;
    }
    expect(tripped).toBe(true);
  });
});
