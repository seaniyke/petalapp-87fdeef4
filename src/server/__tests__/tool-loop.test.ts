import { describe, expect, it } from "vitest";
import { runToolLoop, completionGaps, createToolLoopState, compact, type ModelReply, type LoopMessage, type ToolCallMsg } from "@/server/engine/tool-loop";

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
const base = { goal: "g", system: "sys", brief: "brief", validate };

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
    expect(refusal?.content).toContain("src/pages/About");
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
    await runToolLoop({ ...base, files: [{ path: "src/a.ts", content: "a a" }], callModel: m.callModel, onWrite: () => { writes++; return true; } });
    expect(writes).toBe(1);
  });

  it("pending tasks and required files block finish", () => {
    const s = createToolLoopState("g", [{ id: "page:/x", file: "src/pages/X.tsx", route: "/x" }]);
    s.tasks.set("t1", { id: "t1", title: "x", status: "pending", files: [] });
    expect(completionGaps(s, new Map()).length).toBe(2);
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
    const r = await runToolLoop({ ...base, light: true, files: [{ path: "src/pages/X.tsx", content: "" }], requirements: [{ id: "f", file: "src/missing.ts" }], callModel: async (msgs, t) => { tools = t.map((x) => x.function.name); return m.callModel(msgs); } });
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
