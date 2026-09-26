import { describe, expect, it } from "vitest";
import { runExecutionLoop, reconcileRequirements, routerPages, pageKey } from "@/server/engine/agent-loop";
import { targetOf } from "@/server/engine/write";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

const page = (n: string) => `export default function ${n}() {\n  return <main><h1>${n}</h1></main>;\n}\n`;
const app = (routes: Array<[string, string]>) => ({
  path: "src/App.tsx",
  content: [
    `import { Routes, Route } from "@/components/ui/router";`,
    ...routes.map(([, n]) => `import ${n} from "@/pages/${n}";`),
    `export default function App(){return (<div><header><nav/></header><Routes>`,
    ...routes.map(([r, n]) => `<Route path="${r}" element={<${n} />} />`),
    `</Routes><footer/></div>);}`,
  ].join("\n"),
});
function writer() {
  const seen: string[] = [];
  return {
    seen,
    request: async (i: string) => {
      const t = targetOf(i)!;
      seen.push(t);
      if (t === "src/App.tsx") return null;
      return [{ path: t, content: page(t.split("/").pop()!.replace(".tsx", "")) }];
    },
  };
}

describe("agent loop", () => {
  it("Home vs Dashboard: the home page is one identity and written exactly once", async () => {
    const files = [app([["/", "Dashboard"], ["/patients", "Patients"]])];
    const seed = [{ route: "/", file: "src/pages/Home.tsx" }, { route: "/patients", file: "src/pages/Patients.tsx" }];
    expect(reconcileRequirements(seed, files).map((p) => p.file).sort()).toEqual(["src/pages/Dashboard.tsx", "src/pages/Patients.tsx"]);
    const w = writer();
    const r = await runExecutionLoop({ pages: seed, files, budget: new RecoveryBudget(), request: w.request });
    expect(w.seen.filter((s) => /Dashboard|Home/.test(s))).toEqual(["src/pages/Dashboard.tsx"]);
    expect(r.missing).toEqual([]);
  });

  it("dependencies are discovered from the live router, not a precomputed list", async () => {
    const files = [app([["/", "Home"], ["/wards", "Wards"], ["/billing", "Billing"]])];
    const w = writer();
    const r = await runExecutionLoop({ pages: [{ route: "/", file: "src/pages/Home.tsx" }], files, budget: new RecoveryBudget(), request: w.request });
    expect(w.seen.sort()).toEqual(["src/pages/Billing.tsx", "src/pages/Home.tsx", "src/pages/Wards.tsx"]);
    expect(r.state.completed).toEqual(expect.arrayContaining([pageKey("/wards"), pageKey("/billing")]));
  });

  it("foundation runs before any page and exactly once", async () => {
    const order: string[] = [];
    const files = [app([["/", "Home"]])];
    await runExecutionLoop({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }], files, budget: new RecoveryBudget(),
      request: async (i) => { order.push(targetOf(i)!); return [{ path: targetOf(i)!, content: page("Home") }]; },
      createFoundation: async (f) => { order.push("foundation"); return { files: f, created: [] }; },
    });
    expect(order).toEqual(["foundation", "src/pages/Home.tsx", "foundation"]);
  });

  it("completed files are never regenerated", async () => {
    const files = [app([["/", "Home"], ["/a", "A"]]), { path: "src/pages/Home.tsx", content: page("Home") }];
    const w = writer();
    await runExecutionLoop({ pages: [], files, budget: new RecoveryBudget(), request: w.request });
    expect(w.seen).toEqual(["src/pages/A.tsx"]);
  });

  it("checkpoint is awaited before the next operation starts", async () => {
    const events: string[] = [];
    const files = [app([["/", "Home"]])];
    await runExecutionLoop({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }], files, budget: new RecoveryBudget(),
      request: async (i) => { events.push("write"); return [{ path: targetOf(i)!, content: page("Home") }]; },
      onFilesDone: async () => { await new Promise((r) => setTimeout(r, 5)); events.push("saved"); return true; },
    });
    expect(events).toEqual(["write", "saved"]);
  });

  it("routerPages reads explicit route → file mapping", () => {
    expect(routerPages([app([["/", "Dashboard"]])])).toEqual([{ route: "/", file: "src/pages/Dashboard.tsx" }]);
  });
});

describe("agent loop: dynamic dependencies", () => {
  it("a page importing a new shared module triggers one dependency op before finishing", async () => {
    const calls: Array<string[] | undefined> = [];
    const files = [app([["/", "Home"]])];
    await runExecutionLoop({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }], files, budget: new RecoveryBudget(),
      request: async (i) => [{ path: targetOf(i)!, content: page("Home") }],
      createFoundation: async (f, changed) => { calls.push(changed); return { files: f, created: [] }; },
    });
    expect(calls).toEqual([undefined, ["src/pages/Home.tsx"]]);
  });
});
