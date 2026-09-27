import { describe, expect, it } from "vitest";
import { runToolLoop, toolsFor, type ModelReply, type LoopMessage, type ToolCallMsg } from "@/server/engine/tool-loop";
import { buildKitExportIndex, repairKitImports } from "@/server/engine/kit-import-repair";
import { renderStarterKitMap } from "@/server/engine/template-contract";
import { finalizeVerification, runSourceGates } from "@/server/verification/gates";
import { readinessOf } from "@/server/verification/readiness";
import { KIT_FILES } from "@/server/scaffold-kit";
import { isScaffoldOwnedPath } from "@/server/scaffold-ownership.server";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `k${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls, usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 5 } });
function scripted(steps: ModelReply[]) {
  const seen: LoopMessage[][] = [];
  return { seen, callModel: async (m: LoopMessage[]) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); } };
}
const kit = KIT_FILES.filter((f) => f.path.startsWith("src/components/motion/")).map((f) => ({ path: f.path, content: f.content }));
const PKG = { path: "package.json", content: "{\"dependencies\":{}}" };
const authority = (routes: string[] = []) => (tree: { path: string; content: string }[]) =>
  readinessOf(finalizeVerification(runSourceGates({ files: [...kit.filter((k) => !tree.some((t) => t.path === k.path)), ...tree.filter((f) => f.path !== "package.json"), PKG], requestedRoutes: routes, esbuild: { status: "passed" } })));
// Import validation over the visible workspace (authored + kit), like the real gate.
const validate = (f: { path: string; content: string }, tree: { path: string; content: string }[]) => {
  const errs: string[] = [];
  const idx = buildKitExportIndex(tree);
  for (const m of f.content.matchAll(/import\s+\{([^}]*)\}\s+from\s+"(@\/components\/[^"]+)"/g)) {
    const ex = idx.modules.get(m[2]!);
    if (!ex) { errs.push(`unresolved import ${m[2]}`); continue; }
    for (const p of m[1]!.split(",").map((x) => x.trim()).filter(Boolean)) if (!ex.has(p)) errs.push(`${m[2]} has no export ${p}`);
  }
  return errs;
};
const home = (imp: string) => `${imp}\nexport default function Home(){return <SlideUp><h1>Crumb</h1></SlideUp>;}\n`;
const app = `import Home from "@/pages/Home";\nexport default function App(){return <Home/>;}\n`;
const base = { goal: "g", system: "s", brief: "b", validate, reference: kit };

describe("first-build cleanup", () => {
  it("A: standard kit components are usable without reading their source", async () => {
    const m = scripted([reply(call("create_file", { path: "src/pages/Home.tsx", content: home(`import { SlideUp } from "@/components/motion/slide-up";`) }), call("create_file", { path: "src/App.tsx", content: app }), call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel });
    expect(r.outcome).toBe("finished");
    expect(r.traces.length).toBe(1);
    expect(r.state.read.has("src/components/motion/slide-up.tsx")).toBe(false);
    expect(renderStarterKitMap()).toContain("SlideUp(");
  });

  it("B: existing project files still require read-before-edit", async () => {
    const m = scripted([reply(call("edit_file", { path: "src/App.tsx", search: "Home/", replace: "Home /" }))]);
    await runToolLoop({ ...base, files: [{ path: "src/App.tsx", content: app }], readiness: authority(), callModel: m.callModel, config: { maxIterations: 1, finalizeIterations: 0 } });
    expect(m.seen.length).toBeGreaterThanOrEqual(1);
    const m2 = scripted([reply(call("edit_file", { path: "src/App.tsx", search: "Home/", replace: "Home /" })), reply(call("finish", {}))]);
    const r2 = await runToolLoop({ ...base, files: [{ path: "src/App.tsx", content: app }], readiness: authority(), callModel: m2.callModel });
    const out = m2.seen[1]!.filter((x) => x.role === "tool").map((x) => x.content).join("\n");
    expect(out).toContain("Read src/App.tsx with read_file before editing it");
    expect(r2.files.find((f) => f.path === "src/App.tsx")!.content).toBe(app);
  });

  it("C: unknown/custom imports are never repaired", () => {
    const idx = buildKitExportIndex(kit);
    expect(repairKitImports(`import { SlideUp } from "@/components/site/anim";`, idx)).toBeNull();
    expect(repairKitImports(`import { NotAKitThing } from "@/components/motion/fade-in";`, idx)).toBeNull();
  });

  it("D: known kit symbol from the wrong kit subpath is repaired deterministically", async () => {
    const idx = buildKitExportIndex(kit);
    const r = repairKitImports(`import { FadeIn, SlideUp } from "@/components/motion/fade-in";`, idx)!;
    expect(r.content).toContain(`import { FadeIn } from "@/components/motion/fade-in";`);
    expect(r.content).toContain(`import { SlideUp } from "@/components/motion/slide-up";`);
    const m = scripted([reply(call("create_file", { path: "src/pages/Home.tsx", content: home(`import { SlideUp } from "@/components/motion/fade-in";`) }), call("create_file", { path: "src/App.tsx", content: app }), call("finish", {}))]);
    const loop = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel });
    expect(loop.outcome).toBe("finished");
    expect(loop.traces.length).toBe(1);
    expect(loop.traces[0]!.validationFailures).toBe(0);
    expect(loop.traces[0]!.deterministicRepairs).toBe(1);
  });

  it("E: genuinely invalid imports still fail validation", async () => {
    const m = scripted([reply(call("create_file", { path: "src/pages/Home.tsx", content: home(`import { SlideUp } from "@/components/motion/nope";`) }))]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel, config: { maxIterations: 1, finalizeIterations: 0 } });
    expect(r.state.validation.get("src/pages/Home.tsx")?.[0]).toContain("unresolved import");
    expect(r.outcome).not.toBe("finished");
  });

  it("F: finish succeeds on readiness alone; no task tool exists", async () => {
    expect(toolsFor(false).map((t) => t.function.name)).not.toContain("plan_tasks");
    const m = scripted([reply(call("create_file", { path: "src/App.tsx", content: `export default function App(){return <main/>;}\n` }), call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel });
    expect(r.outcome).toBe("finished");
  });

  it("G: required pages come from the brief's requested routes, not a model list", async () => {
    const router = (pages: string[]) => `import { BrowserRouter, Routes, Route } from "react-router-dom";\n${pages.map((p) => `import ${p} from "@/pages/${p}";`).join("\n")}\nexport default function App(){return <BrowserRouter><Routes>${pages.map((p) => `<Route path="/${p === "Home" ? "" : p.toLowerCase()}" element={<${p}/>} />`).join("")}</Routes></BrowserRouter>;}\n`;
    const pg = (p: string) => `export default function ${p}(){return <main>${p}</main>;}\n`;
    const m = scripted([
      reply(call("create_file", { path: "src/pages/Home.tsx", content: pg("Home") }), call("create_file", { path: "src/App.tsx", content: router(["Home"]) }), call("finish", {})),
      reply(call("create_file", { path: "src/pages/Menu.tsx", content: pg("Menu") }), call("create_file", { path: "src/App.tsx", content: router(["Home", "Menu"]) }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(["/", "/menu"]), callModel: m.callModel });
    expect(m.seen[1]!.some((x) => x.role === "tool" && x.content.includes("finish refused"))).toBe(true);
    expect(r.outcome).toBe("finished");
  });

  it("H/I: kit files stay owned; new files in kit directories are project code", () => {
    expect(isScaffoldOwnedPath("src/components/motion/slide-up.tsx")).toBe(true);
    expect(isScaffoldOwnedPath("src/components/motion/crumb-rise.tsx")).toBe(false);
  });

  it("H: overwriting a kit file is still refused", async () => {
    const m = scripted([reply(call("create_file", { path: "src/components/motion/slide-up.tsx", content: "export const SlideUp = 1;" }))]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel, config: { maxIterations: 1, finalizeIterations: 0 } });
    expect(r.files.find((f) => f.path === "src/components/motion/slide-up.tsx")).toBeUndefined();
  });

  it("J: final verification still blocks a broken build", async () => {
    const m = scripted([reply(call("create_file", { path: "src/App.tsx", content: app }), call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [], readiness: authority(), callModel: m.callModel, config: { maxIterations: 1, finalizeIterations: 0 } });
    expect(r.outcome).not.toBe("finished");
    expect(r.incomplete.join("\n")).toContain("@/pages/Home");
  });
});
