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
