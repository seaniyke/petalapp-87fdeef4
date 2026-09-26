import { describe, expect, it } from "vitest";
import { runToolLoop, completionGaps, createToolLoopState, compact, stableFoundations, type ModelReply, type LoopMessage, type ToolCallMsg } from "@/server/engine/tool-loop";
import { finalizeVerification, runSourceGates } from "@/server/verification/gates";
import { readinessOf } from "@/server/verification/readiness";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls, usage: { promptTokens: 100, cachedTokens: 80, completionTokens: 50 } });

function scripted(steps: ModelReply[]) {
  const seen: LoopMessage[][] = [];
  return {
    seen,
    callModel: async (m: LoopMessage[]) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); },
  };
}
const page = (n: string) => `export default function ${n}() { return <main>${n}</main>; }\n`;
const app = `import Home from "@/pages/Home";\nimport About from "@/pages/About";\nexport default function App(){return <Home/>;}\n`;
const validate = (f: { path: string; content: string }) => (f.content.includes("BROKEN") ? [`parse: unexpected token in ${f.path}`] : []);
// The REAL authority (same gates commit uses), over the loop's workspace.
const PKG = { path: "package.json", content: "{\"dependencies\":{}}" };
const authority = (routes: () => string[] = () => []) => (tree: { path: string; content: string }[]) =>
  readinessOf(finalizeVerification(runSourceGates({ files: [...tree.filter((f) => f.path !== "package.json"), PKG], requestedRoutes: routes(), esbuild: { status: "passed" } })));
const base = { goal: "g", system: "sys", brief: "brief", validate, readiness: authority() };

describe("tool loop", () => {
  it("several writes in one model response; one conversation drives the build", async () => {
    const m = scripted([
      reply(call("create_file", { path: "src/App.tsx", content: app }), call("create_file", { path: "src/pages/Home.tsx", content: page("Home") }), call("create_file", { path: "src/pages/About.tsx", content: page("About") })),
      reply(call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files: [], callModel: m.callModel });
    expect(r.outcome).toBe("finished");
    expect(r.traces.length).toBe(2);
    expect(r.traces[0]!.writes).toBe(3);
    // second call sees tool results of the first in the same conversation
    expect(m.seen[1]!.filter((x) => x.role === "tool").length).toBe(3);
  });

  it("bakery regression: finish refused while the router imports a missing page", async () => {
    const m = scripted([
      reply(call("create_file", { path: "src/App.tsx", content: app }), call("create_file", { path: "src/pages/Home.tsx", content: page("Home") }), call("finish", {})),
      reply(call("create_file", { path: "src/pages/About.tsx", content: page("About") }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files: [], callModel: m.callModel });
    const refusal = m.seen[1]!.find((x) => x.role === "tool" && x.content.includes("finish refused"));
    expect(refusal?.content).toContain("@/pages/About");
    expect(r.outcome).toBe("finished");
  });

  it("a broken write is reported as the tool result and blocks finish until fixed by edit", async () => {
    const m = scripted([
      reply(call("create_file", { path: "src/pages/Home.tsx", content: "BROKEN" }), call("finish", {})),
      reply(call("edit_file", { path: "src/pages/Home.tsx", search: "BROKEN", replace: page("Home") }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files: [], callModel: m.callModel });
    const tool = m.seen[1]!.filter((x) => x.role === "tool").map((x) => x.content).join("\n");
    expect(tool).toContain("FAILS validation");
    expect(tool).toContain("finish refused");
    expect(r.outcome).toBe("finished");
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe(page("Home"));
  });

  it("files that arrive from elsewhere get the same validation boundary", async () => {
    // Pre-existing broken file is not in validation state, but any write to it is validated.
    const m = scripted([reply(call("read_file", { path: "src/a.tsx" }), call("edit_file", { path: "src/a.tsx", search: "x", replace: "BROKEN" }))]);
    const r = await runToolLoop({ ...base, files: [{ path: "src/a.tsx", content: "const x = 1;" }], callModel: m.callModel });
    expect(r.files[0]!.content).toBe("const x = 1;"); // rolled back
  });

  it("edit_file requires read-before-edit and a unique match", async () => {
    const m = scripted([
      reply(call("edit_file", { path: "src/a.ts", search: "1", replace: "2" })),
      reply(call("read_file", { path: "src/a.ts" }), call("edit_file", { path: "src/a.ts", search: "v", replace: "w" })),
      reply(call("edit_file", { path: "src/a.ts", search: "v", replace: "w", occurrence: 2 }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files: [{ path: "src/a.ts", content: "v;v;" }], callModel: m.callModel });
    const outs = m.seen.flatMap((s) => s.filter((x) => x.role === "tool").map((x) => x.content));
    expect(outs.some((o) => o.includes("Read src/a.ts with read_file"))).toBe(true);
    expect(outs.some((o) => o.includes("matches 2 places"))).toBe(true);
    expect(r.files[0]!.content).toBe("v;w;");
  });

  it("existing files cannot be blindly overwritten", async () => {
    const m = scripted([reply(call("create_file", { path: "src/a.ts", content: "new" })), reply(call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [{ path: "src/a.ts", content: "old" }], callModel: m.callModel });
    expect(r.files[0]!.content).toBe("old");
  });

  it("duplicate work is refused by operation identity", async () => {
    const m = scripted([
      reply(call("read_file", { path: "src/a.ts" }), call("edit_file", { path: "src/a.ts", search: "a", replace: "b" })),
      reply(call("edit_file", { path: "src/a.ts", search: "a", replace: "b" }), call("finish", {})),
    ]);
    let writes = 0;
    await runToolLoop({ ...base, files: [{ path: "src/a.ts", content: "a;" }], callModel: m.callModel, onWrite: () => { writes++; return true; } });
    expect(writes).toBe(1);
  });

  it("pending tasks block finish; the loop keeps no structural rules of its own", () => {
    const s = createToolLoopState("g");
    s.tasks.set("t1", { id: "t1", title: "x", status: "pending", files: [] });
    expect(completionGaps(s, new Map([["src/App.tsx", app]])).length).toBe(1);
  });

  it("typecheck runs every N writes and its errors enter the conversation", async () => {
    const m = scripted([
      reply(call("create_file", { path: "a.ts", content: "1" }), call("create_file", { path: "b.ts", content: "2" }), call("create_file", { path: "c.ts", content: "3" })),
      reply(call("finish", {})),
    ]);
    let checks = 0;
    await runToolLoop({ ...base, files: [], callModel: m.callModel, typecheck: () => { checks++; return ["a.ts(1,1): error TS2322"]; } });
    expect(checks).toBe(1);
    expect(m.seen[1]!.some((x) => x.role === "user" && x.content.includes("TS2322"))).toBe(true);
  });

  it("circuit breaker stops a loop repeating the same failure", async () => {
    const bad = () => reply(call("edit_file", { path: "nope.ts", search: "a", replace: "b" }));
    const m = scripted(Array.from({ length: 20 }, bad));
    const r = await runToolLoop({ ...base, files: [], callModel: m.callModel });
    expect(r.outcome).toBe("breaker");
    expect(r.traces.length).toBeLessThan(10);
  });

  it("light mode is capped and exposes only the edit tools", async () => {
    const m = scripted(Array.from({ length: 20 }, () => reply(call("search", { query: "zz" }))));
    let tools: string[] = [];
    const r = await runToolLoop({ ...base, light: true, files: [{ path: "src/pages/X.tsx", content: "" }], readiness: () => ({ ready: false, findings: [{ gate: "routes", reason: "missing requested: /x", paths: [] }] }), callModel: async (msgs, t) => { tools = t.map((x) => x.function.name); return m.callModel(msgs); } });
    expect(tools).not.toContain("plan_tasks");
    expect(r.traces.length).toBe(8);
    expect(r.outcome).toBe("incomplete");
  });

  it("compaction keeps system+brief prefix and never splits a tool group", () => {
    const s = createToolLoopState("g");
    const msgs: LoopMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "brief" }];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "assistant", content: null, tool_calls: [call("read_file", { path: "a" })] });
      msgs.push({ role: "tool", tool_call_id: `t${i}`, content: "x" });
    }
    const out = compact(msgs, s, 5);
    expect(out[0]!.content).toBe("sys");
    expect(out[1]!.content).toBe("brief");
    expect(out[3]!.role).toBe("assistant");
  });

  it("cancellation stops before the next model call", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runToolLoop({ ...base, files: [], callModel: async () => reply(), signal: ac.signal });
    expect(r.outcome).toBe("cancelled");
    expect(r.traces.length).toBe(0);
  });
});

describe("seeded first-response files", () => {
  it("are validated at loop start and block finish until fixed (bakery shell-page regression)", async () => {
    const m = scripted([reply(call("finish", {})), reply(call("read_file", { path: "src/pages/About.tsx" }), call("edit_file", { path: "src/pages/About.tsx", search: "BROKEN", replace: "ok" }), call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [{ path: "src/pages/About.tsx", content: "BROKEN" }], seedPaths: ["src/pages/About.tsx"], callModel: m.callModel });
    expect(String(m.seen[0]![1]!.content)).toContain("FAIL validation");
    expect(r.outcome).toBe("finished");
    expect(r.files[0]!.content).toBe("ok");
  });
});

describe("tool loop transport", () => {
  it("never sends parallel_tool_calls (OpenRouter has no endpoint for it with require_parameters → 404)", async () => {
    const { makeCallModel } = await import("@/server/engine/tool-loop-model");
    let sent: Record<string, unknown> = {};
    const cm = makeCallModel(async (b) => { sent = b; return new Response("data: [DONE]\n\n", { status: 200 }); });
    await cm([{ role: "user", content: "x" }], []);
    expect("parallel_tool_calls" in sent).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* One readiness authority + stable foundations (architecture tests)   */
/* ------------------------------------------------------------------ */

const shell = `import Home from "./pages/Home";\nexport default function App(){return <div><header><nav>Home</nav></header><Home/><footer>f</footer></div>;}\n`;
const tool = (m: { seen: LoopMessage[][] }) => m.seen.flatMap((s) => s.filter((x) => x.role === "tool" || x.role === "user").map((x) => String(x.content))).join("\n");

describe("one readiness authority", () => {
  it("1: agent says finish, authority says incomplete → refused with exact evidence in the same conversation", async () => {
    const m = scripted([reply(call("finish", {})), reply(call("create_file", { path: "src/pages/Home.tsx", content: page("Home") }), call("finish", {}))]);
    const r = await runToolLoop({ ...base, files: [{ path: "src/App.tsx", content: shell }], seedPaths: ["src/App.tsx"], callModel: m.callModel });
    const out = tool(m);
    expect(out).toContain("NOT READY");
    expect(out).toContain("[dependencies]");
    expect(out).toContain("./pages/Home");
    expect(out).toContain("Required next operation");
    expect(r.outcome).toBe("finished");
    expect(m.seen.length).toBe(2);
  });

  it("2: a valid stable layout is not rewritten by later page work", async () => {
    const files = [{ path: "src/App.tsx", content: shell }, { path: "src/pages/Home.tsx", content: page("Home") }, { path: "src/main.tsx", content: `import App from "./App";\nexport const x = App;\n` }];
    const m = scripted([reply(call("read_file", { path: "src/App.tsx" }), call("create_file", { path: "src/App.tsx", content: "export default function App(){return null}\n" }), call("create_file", { path: "src/pages/Menu.tsx", content: page("Menu") }))]);
    const r = await runToolLoop({ ...base, files, seedPaths: files.map((f) => f.path), callModel: m.callModel });
    expect(tool(m)).toContain("STABLE foundation");
    expect(String(m.seen[0]![1]!.content)).toContain("STABLE foundations");
    expect(r.files.find((f) => f.path === "src/App.tsx")!.content).toBe(shell);
    expect(r.files.some((f) => f.path === "src/pages/Menu.tsx")).toBe(true);
  });

  it("3: a feature that genuinely needs the layout gets a targeted edit; a regressing edit is rolled back", async () => {
    const files = [{ path: "src/App.tsx", content: shell }, { path: "src/pages/Home.tsx", content: page("Home") }, { path: "src/main.tsx", content: `import App from "./App";\nexport const x = App;\n` }];
    const m = scripted([
      reply(
        call("create_file", { path: "src/pages/Menu.tsx", content: page("Menu") }),
        call("read_file", { path: "src/App.tsx" }),
        call("edit_file", { path: "src/App.tsx", search: `import Home from "./pages/Home";`, replace: `import Home from "./pages/Home";\nimport Gone from "./pages/Gone";` }),
        call("edit_file", { path: "src/App.tsx", search: `<nav>Home</nav>`, replace: `<nav>Home Menu</nav>` }),
      ),
      reply(call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, files, seedPaths: files.map((f) => f.path), callModel: m.callModel });
    const app2 = r.files.find((f) => f.path === "src/App.tsx")!.content;
    expect(tool(m)).toContain("breaks verification");
    expect(app2).not.toContain("Gone");
    expect(app2).toContain("<nav>Home Menu</nav>");
    expect(r.outcome).toBe("finished");
  });

  it("4: a requirement added mid-run is enforced from the live requirements, not model memory", async () => {
    const routes = ["/"];
    const m = scripted([
      reply(call("create_file", { path: "src/pages/Home.tsx", content: page("Home") })),
      reply(call("finish", {})),
      reply(call("create_file", { path: "src/pages/Contact.tsx", content: page("Contact") }), call("finish", {})),
    ]);
    const cm = async (msgs: LoopMessage[]) => { if (m.seen.length === 1) routes.push("/contact"); return m.callModel(msgs); };
    const r = await runToolLoop({ ...base, readiness: authority(() => routes), files: [], callModel: cm });
    expect(tool(m)).toContain("missing requested");
    expect(r.outcome).toBe("finished");
  });

  it("5: after compaction, completion knowledge comes from the workspace", () => {
    const s = createToolLoopState("g");
    const files = new Map([["src/App.tsx", shell], ["src/pages/Home.tsx", page("Home")]]);
    const r = runToolLoop; void r;
    // Evidence is derived: record clean validation for both files.
    for (const [p, c] of files) { s.validation.set(p, []); s.validatedHash.set(p, hashOf(c)); }
    const msgs: LoopMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "brief" }];
    for (let i = 0; i < 30; i++) { msgs.push({ role: "assistant", content: null, tool_calls: [call("read_file", { path: "a" })] }); msgs.push({ role: "tool", tool_call_id: `t${i}`, content: "x" }); }
    const out = compact(msgs, s, 5, files);
    expect(String(out[2]!.content)).toContain("src/pages/Home.tsx ← used by src/App.tsx");
  });

  it("6: a file that becomes invalid through a changed dependency is detected before finish", async () => {
    const files = [{ path: "src/lib/api.ts", content: "export const load = () => 1;\n" }, { path: "src/pages/Home.tsx", content: `import { load } from "../lib/api";\nexport default function Home(){return <p>{load()}</p>;}\n` }];
    // Validator reports a missing named export (like validateUnitImports).
    const v = (f: { path: string; content: string }, tree: { path: string; content: string }[]) =>
      f.path.endsWith("Home.tsx") && !tree.find((t) => t.path === "src/lib/api.ts")!.content.includes("load") ? ["src/lib/api.ts has no export load"] : [];
    const m = scripted([
      reply(call("read_file", { path: "src/lib/api.ts" }), call("edit_file", { path: "src/lib/api.ts", search: "load", replace: "fetchAll" }), call("finish", {})),
      reply(call("edit_file", { path: "src/lib/api.ts", search: "fetchAll", replace: "load" }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, validate: v, files, seedPaths: files.map((f) => f.path), callModel: m.callModel });
    expect(tool(m)).toContain("no export load");
    expect(r.outcome).toBe("finished");
  });

  it("7: an unanticipated verifier finding enters the same execution state and the agent continues", async () => {
    let flagged = true;
    const readiness = () => (flagged ? { ready: false, findings: [{ gate: "routes", reason: "route /x is an unfinished placeholder page", paths: ["src/pages/X.tsx"] }] } : { ready: true, findings: [] });
    const m = scripted([
      reply(call("finish", {})),
      reply(call("create_file", { path: "src/pages/X.tsx", content: page("X") }), call("finish", {})),
    ]);
    const r = await runToolLoop({ ...base, readiness, files: [], callModel: async (msgs) => { if (m.seen.length === 1) flagged = false; return m.callModel(msgs); } });
    expect(tool(m)).toContain("targeted edit of src/pages/X.tsx");
    expect(r.state.readiness?.ready).toBe(true);
    expect(r.outcome).toBe("finished");
  });

  it("stability is derived from imports, not filenames", () => {
    const s = createToolLoopState("g");
    const files = new Map([["src/whatever/Shell.tsx", `import P from "./P";\nexport default P;\n`], ["src/whatever/P.tsx", page("P")]]);
    for (const [p, c] of files) { s.validation.set(p, []); s.validatedHash.set(p, hashOf(c)); }
    expect([...stableFoundations(s, files).keys()]).toEqual(["src/whatever/P.tsx"]);
  });
});

function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
