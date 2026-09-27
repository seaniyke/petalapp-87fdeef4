/**
 * Regressions from failed bakery benchmark 9da6bafa: kit modules invisible
 * to the loop, contradictory template.json rules, a frame check that rejected
 * a shared layout, and 37 zero-progress steps.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KIT_FILES } from "@/server/scaffold-kit";
import {
  REFERENCE_DIRS,
  renderTemplateMetadataSection,
  templateContract,
  templateGroundingRule,
  TEMPLATE_PRELOADED_RULE,
  TEMPLATE_READ_RULE,
} from "@/server/engine/template-contract";
import { firstBuildBrief } from "@/server/engine/first-build";
import { frameIsComplete } from "@/server/engine/write";
import { validateUnitImports } from "@/server/engine/work-unit";
import { loadCoreKnowledge, loadSkillKnowledge, __resetKnowledgeCache } from "@/server/agent-knowledge";
import { runToolLoop, diagnoseTrajectory, type ModelReply, type LoopMessage, type ToolCallMsg } from "@/server/engine/tool-loop";

const kitPaths = new Set(KIT_FILES.map((f) => f.path));
const f = (path: string, content: string) => ({ path, content });
let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls });

describe("template metadata describes reality", () => {
  it("every advertised @/ path resolves to a shipped kit file", () => {
    const s = renderTemplateMetadataSection();
    const specs = [...s.matchAll(/@\/[\w/-]+/g)].map((m) => m[0].replace(/\/\*$/, ""));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const base = `src/${spec.slice(2)}`;
      const ok = [...kitPaths].some((p) => p === `${base}.tsx` || p === `${base}.ts` || p.startsWith(`${base}/`));
      expect(ok, spec).toBe(true);
    }
    for (const d of REFERENCE_DIRS) if (s.includes(d)) expect([...kitPaths].some((p) => p.startsWith(`src/${d.slice(2)}/`))).toBe(true);
  });

  it("every shadcn component and custom_components dir in template.json ships", () => {
    const c = templateContract()!;
    for (const name of c["shadcn_components"] as string[]) {
      expect(kitPaths.has(`src/components/ui/${name}.tsx`) || kitPaths.has(`src/components/ui/${name}.ts`), name).toBe(true);
    }
    for (const d of c["custom_components"] as string[]) expect([...kitPaths].some((p) => p.startsWith(d.replace("/*", "/")))).toBe(true);
  });
});

describe("one template grounding rule", () => {
  it("preloaded metadata does not require a template.json read", () => {
    const brief = firstBuildBrief("bakery", [{ route: "/", file: "src/pages/Home.tsx" }], []);
    expect(brief).toContain(TEMPLATE_PRELOADED_RULE);
    expect(templateGroundingRule(brief)).toBe("");
    expect(brief).not.toMatch(/do not read it/);
  });

  it("without preloaded metadata the model must read template.json", () => {
    expect(templateGroundingRule("fix the header colour")).toBe(TEMPLATE_READ_RULE);
  });

  it("no loaded knowledge demands a template.json read", () => {
    __resetKnowledgeCache();
    const all = [loadCoreKnowledge("full").text, loadCoreKnowledge("compact").text, loadSkillKnowledge("section-architectures")].join("\n");
    expect(all).not.toMatch(/readFile\(\s*"template\.json"\s*\)/);
    expect(all).not.toMatch(/\b(read|check) `?template\.json/i);
    expect(all).not.toMatch(/FIRST tool call/i);
  });
});

describe("frameIsComplete understands shared layouts", () => {
  const routes = `<BrowserRouter><Routes><Route element={<SiteLayout />}><Route path="/" element={<Home />} /><Route path="/menu" element={<Menu />} /></Route></Routes></BrowserRouter>`;
  const layout = `import { Outlet, Link } from "react-router-dom";\nexport function SiteLayout(){return <div><header><nav><Link to="/">Home</Link></nav></header><Outlet /><footer>Crumb</footer></div>;}`;

  it("accepts nav/footer directly in App.tsx", () => {
    expect(frameIsComplete([f("src/App.tsx", "<header><nav/></header><Routes><Route/></Routes><footer/>")])).toBe(true);
  });

  it("accepts nav/footer in an imported, rendered shared layout", () => {
    const app = `import { SiteLayout } from "@/components/layout";\nexport default function App(){return ${routes};}`;
    expect(frameIsComplete([f("src/App.tsx", app), f("src/components/layout.tsx", layout)], 2)).toBe(true);
  });

  it("rejects an incomplete shell", () => {
    expect(frameIsComplete([f("src/App.tsx", `export default function App(){return <Routes><Route/></Routes>;}`)])).toBe(false);
    const noFooter = layout.replace("<footer>Crumb</footer>", "");
    const app = `import { SiteLayout } from "@/components/layout";\nexport default function App(){return ${routes};}`;
    expect(frameIsComplete([f("src/App.tsx", app), f("src/components/layout.tsx", noFooter)], 2)).toBe(false);
  });

  it("ignores an unrelated component with nav/footer that App never renders", () => {
    const app = `import { SiteLayout } from "@/components/layout";\nexport default function App(){return <Routes><Route path="/" element={<main/>} /></Routes>;}`;
    expect(frameIsComplete([f("src/App.tsx", app), f("src/components/layout.tsx", layout)], 2)).toBe(false);
  });
});

describe("router contract", () => {
  const tree = KIT_FILES.filter((k) => k.path.startsWith("src/"));
  it("rejects an invented router module before it costs iterations", () => {
    const d = validateUnitImports(f("src/components/layout.tsx", `import { Link } from "@/lib/router";\nexport const X = () => <Link to="/" />;`), tree);
    expect(d.some((x) => x.message.includes("does not exist"))).toBe(true);
  });
  it("accepts react-router-dom and the kit re-export", () => {
    expect(validateUnitImports(f("src/a.tsx", `import { Link } from "react-router-dom";`), tree)).toEqual([]);
    expect(validateUnitImports(f("src/a.tsx", `import { Link, Outlet } from "@/components/ui/router";`), tree)).toEqual([]);
  });
  it("the brief names the real router source", () => {
    expect(firstBuildBrief("x", [], [])).toMatch(/react-router-dom/);
  });
});

describe("loop sees the kit (read-only)", () => {
  it("kit modules resolve for reads and validation, and are never returned as written", async () => {
    const reference = [f("src/components/ui/button.tsx", "export function Button(){return null}")];
    const seen: LoopMessage[][] = [];
    const steps = [
      reply(call("read_file", { path: "src/components/ui/button.tsx" }), call("create_file", { path: "src/pages/Home.tsx", content: `import { Button } from "@/components/ui/button";\nexport default function Home(){return <Button/>}` })),
      reply(call("finish", {})),
    ];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [], reference,
      validate: (file, t) => validateUnitImports(file, t).map((d) => d.message),
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async (m) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); },
    });
    const tools = seen[1]!.filter((x) => x.role === "tool").map((x) => x.content).join("\n");
    expect(tools).not.toContain("File not found");
    expect(tools).toContain("OK: src/pages/Home.tsx");
    expect(r.outcome).toBe("finished");
    expect(r.files.map((x) => x.path)).toEqual(["src/pages/Home.tsx"]);
  });

  it("an early file importing a later one in the same response is re-checked", async () => {
    const seen: LoopMessage[][] = [];
    const steps = [
      reply(
        call("create_file", { path: "src/App.tsx", content: `import Home from "@/pages/Home";\nexport default function App(){return <Home/>}` }),
        call("create_file", { path: "src/pages/Home.tsx", content: "export default function Home(){return null}" }),
      ),
      reply(call("finish", {})),
    ];
    await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: (file, t) => validateUnitImports(file, t).map((d) => d.message),
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async (m) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); },
    });
    expect(seen[1]!.some((x) => x.role === "user" && String(x.content).includes("Now valid") && String(x.content).includes("src/App.tsx"))).toBe(true);
  });
});

describe("no-progress protection", () => {
  const loop = (script: () => ModelReply, cfg = {}) => {
    let calls = 0;
    const seen: LoopMessage[][] = [];
    const p = runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: () => [],
      readiness: () => ({ ready: false, findings: [{ gate: "routes", reason: "missing", paths: [] }] }),
      config: { noProgressLimit: 4, noProgressRecovery: 2, ...cfg },
      callModel: async (m) => { calls++; seen.push(m.slice()); return script(); },
    });
    return { p, seen, calls: () => calls };
  };

  it("repeated nonexistent-resource reads trigger one corrective signal naming them", async () => {
    const l = loop(() => reply(call("read_file", { path: "src/components/ui/nope.tsx" })));
    const r = await l.p;
    const signals = l.seen.at(-1)!.filter((x) => x.role === "user" && String(x.content).startsWith("No progress"));
    expect(signals.length).toBe(1);
    expect(String(signals[0]!.content)).toContain("src/components/ui/nope.tsx");
    expect(r.outcome).toBe("no_progress");
  });

  it("zero-write iterations cannot continue indefinitely; recovery is bounded", async () => {
    const l = loop(() => reply(call("list_files", { prefix: "src" })));
    const r = await l.p;
    expect(r.outcome).toBe("no_progress");
    expect(l.calls()).toBe(4 + 2);
    expect(r.state.stopReason).toMatch(/no progress/);
  });

  it("a real valid write resets the counter", async () => {
    let i = 0;
    const l = loop(() => {
      i++;
      if (i === 3) return reply(call("create_file", { path: "src/pages/A.tsx", content: "export default function A(){return null}" }));
      if (i > 9) return reply(call("finish", {}));
      return reply(call("list_files", { prefix: "src" }));
    }, { noProgressLimit: 4, noProgressRecovery: 2 });
    const r = await l.p;
    // Without the reset the loop would stop at call 6.
    expect(l.calls()).toBeGreaterThan(6);
    expect(r.outcome).toBe("no_progress");
  });

  it("diagnosis names repeated failures and refused finishes", () => {
    const s = diagnoseTrajectory([
      { tool: "finish", path: null, key: "finish:x", isError: true, miss: false, firstLine: "finish refused." },
      { tool: "finish", path: null, key: "finish:x", isError: true, miss: false, firstLine: "finish refused." },
    ]);
    expect(s).toMatch(/repeated the same finish 2 times/);
    expect(s).toMatch(/finish was refused/);
  });
});

describe("first build stays on the tool loop", () => {
  const gen = readFileSync("src/routes/api/generate.ts", "utf8");
  it("does not regress to the removed legacy writer", () => {
    expect(gen).toContain("runToolLoop({");
    expect(gen).not.toMatch(/writePlannedPages\s*\(/);
  });
  it("first builds enter the tool loop without a monolithic model stream", () => {
    // First builds skip relayAndCollect entirely: the workspace (empty or a
    // resumed checkpoint) is handed straight to the loop. Remaining
    // "write_project" strings are edit-path code and the isInitial sentinel.
    expect(gen).toMatch(/let collected: ParsedTool = isInitial/);
    expect(gen).not.toMatch(/isInitial\s*\?\s*await relayAndCollect/);
  });
  it("no fallback to the old first-build engine", () => {
    expect(gen).not.toMatch(/legacyFirstBuild|fallbackToLegacy|runAgentLoop\s*\(/);
  });
});
