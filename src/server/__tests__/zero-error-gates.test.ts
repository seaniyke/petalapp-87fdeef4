import { describe, expect, it } from "vitest";
import { routesGate } from "@/server/verification/gates";
import { runToolLoop, tolerantMatch, REPEATED_REFUSAL_LIMIT, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `z${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...c: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: c } as unknown as ModelReply);

describe("non-blocking checks", () => {
  const app = `import { Routes, Route } from "react-router-dom";\nimport Home from "./pages/Home";\nexport default function App(){return <div><header><nav>n</nav></header><Routes><Route path="/" element={<Home/>}/></Routes><footer>f</footer></div>;}\n`;
  it("a link to a page that does not exist is a warning, never a failure", () => {
    const home = `import { Link } from "react-router-dom";\nexport default function Home(){return <main><h1>Welcome to our shop</h1><p>Fresh goods daily for everyone.</p><Link to="/bookng">Book</Link></main>}\n`;
    const r = routesGate([{ path: "src/App.tsx", content: app }, { path: "src/pages/Home.tsx", content: home }], ["/"], { requireShell: true });
    expect(r.verdict).toBe("WARNING");
  });
  it("a page with its own header nav is a warning, never a failure", () => {
    const home = `export default function Home(){return <main><header><nav><a href="/">Home</a></nav></header><h1>Welcome to our shop</h1><p>Fresh goods daily for everyone.</p></main>}\n`;
    const r = routesGate([{ path: "src/App.tsx", content: app }, { path: "src/pages/Home.tsx", content: home }], ["/"], { requireShell: true });
    expect(r.verdict).toBe("WARNING");
  });
});

describe("edit_file tolerant match", () => {
  it("matches the same lines with different indentation", () => {
    const hay = "a\n    const x = 1;\n    return x;\nz";
    const m = tolerantMatch(hay, "const x = 1;\nreturn x;");
    expect(hay.slice(m!.start, m!.end)).toBe("    const x = 1;\n    return x;");
  });
  it("refuses when ambiguous", () => {
    expect(tolerantMatch("  a\n  a\n", "a")).toBeNull();
  });
});

describe("repeated refusal breaker", () => {
  it(`stops after ${REPEATED_REFUSAL_LIMIT} identical finish refusals`, async () => {
    let calls = 0;
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: () => [],
      readiness: () => ({ ready: false, findings: [{ gate: "routes", reason: "missing requested: /x", paths: [] }] }),
      callModel: async () => { calls++; return reply(call("create_file", { path: `src/f${calls}.ts`, content: `export const v${calls}=1;\n` }), call("finish", {})); },
    });
    expect(r.outcome).toBe("no_progress");
    expect(calls).toBe(REPEATED_REFUSAL_LIMIT);
  });
});

import { addMissingImports, buildProviders, detectRouterModule, importCandidates } from "@/server/engine/missing-import-repair";

describe("missing import repair", () => {
  const providers = buildProviders({ routerModule: "react-router-dom" });
  it("adds a React hook import after the existing imports", () => {
    const src = `import { Button } from "@/components/ui/button";\nexport default function A(){ const [x] = useState(0); return <Button>{x}</Button>; }\n`;
    const r = addMissingImports(src, ["useState"], providers)!;
    expect(r.content.split("\n")[1]).toBe(`import { useState } from "react";`);
  });
  it("merges into an existing import from the same module", () => {
    const src = `import { useState } from "react";\nexport default function A(){ useEffect(()=>{},[]); const [x]=useState(0); return x; }\n`;
    expect(addMissingImports(src, ["useEffect"], providers)!.content).toContain(`import { useState, useEffect } from "react";`);
  });
  it("never adds an import for an unknown name", () => {
    expect(addMissingImports("export const a = Sparkles;", ["Sparkles"], providers)).toBeNull();
  });
  it("router names come only from the router the project already uses", () => {
    expect(detectRouterModule([["src/App.tsx", `import { Routes, Route } from "react-router-dom";`]])).toBe("react-router-dom");
    expect(buildProviders({ routerModule: null }).has("Link")).toBe(false);
  });
  it("candidates skip names already imported", () => {
    expect(importCandidates(`import { Link } from "react-router-dom";\n<Link/>; useState(1);`, providers)).toEqual(["useState"]);
  });
  it("the tool loop adds a missing import while writing (Amara Glow class of failure)", async () => {
    const page = `export default function Home(){ const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }\n`;
    const steps = [reply(call("create_file", { path: "src/pages/Home.tsx", content: page })), reply(call("finish", {}))];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: () => [],
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async () => steps.shift() ?? reply(call("finish", {})),
    });
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toContain(`import { useState } from "react";`);
  });
});

import { buildProviders as bp2, addMissingImports as ami2 } from "@/server/engine/missing-import-repair";
describe("icon auto-import", () => {
  it("adds a known lucide icon only when the project uses lucide-react", () => {
    expect(bp2({ routerModule: null, usesLucide: true }).get("ArrowRight")).toBe("lucide-react");
    expect(bp2({ routerModule: null }).get("ArrowRight")).toBeUndefined();
    const r = ami2("export default () => <ArrowRight />;", ["ArrowRight"], bp2({ routerModule: null, usesLucide: true }));
    expect(r?.content).toContain('import { ArrowRight } from "lucide-react";');
  });
  it("a kit module exporting the same name wins over the icon", () => {
    const p = bp2({ routerModule: null, usesLucide: true, kitOwners: new Map([["Star", ["@/components/kit/star"]]]) });
    expect(p.get("Star")).toBe("@/components/kit/star");
  });
});
