import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runToolLoop, detectExplorationDrift, EXPLORATION_DRIFT_SIGNAL, type ModelReply, type CallTrace, type ActionRecord } from "@/server/engine/tool-loop";
import { createTelemetrySink, runWithExecutionSummary, takeExecutionSummary } from "@/server/engine/loop-telemetry";
import { renderTemplateMetadataSection, renderStarterKitMap } from "@/server/engine/template-contract";
import { FIRST_BUILD_TOOL_NOTE } from "@/server/engine/first-build";

let n = 0;
const call = (name: string, args: Record<string, unknown>) => ({ id: `c${++n}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ReturnType<typeof call>[]): ModelReply => ({ content: null, toolCalls: calls });
const kit = [
  { path: "src/components/blocks/nav-bar.tsx", content: "export function NavBar() { return null }\n" },
  { path: "src/components/ui/container.tsx", content: "export function Container() { return null }\n" },
  { path: "src/components/blocks/footer-minimal.tsx", content: "export function FooterMinimal() { return null }\n" },
  { path: "src/components/examples/form-contact.tsx", content: "export default function F() { return null }\n" },
];
const base = (replies: ModelReply[], extra: Record<string, unknown> = {}) => ({
  goal: "g", system: "s", brief: "b", files: [], reference: kit,
  callModel: async (msgs: unknown[]) => { seen.push(JSON.stringify(msgs)); return replies.shift() ?? reply(call("finish", {})); },
  validate: async () => [],
  readiness: async () => ({ ready: true, findings: [] }),
  ...extra,
});
let seen: string[] = [];

describe("first build: starter-kit map instead of discovery", () => {
  it("the preloaded contract carries a compact, authoritative kit map with paths and exports", () => {
    const section = renderTemplateMetadataSection();
    const map = renderStarterKitMap();
    expect(section).toContain(map);
    expect(map).toMatch(/do not list directories/);
    expect(map).toMatch(/- nav-bar \{NavBar\}/);
    expect(map).toMatch(/- hero-split-image \{HeroSplitImage\}/);
    // map, not contents
    expect(map.length).toBeLessThan(12_000);
    expect(map).not.toMatch(/import \* as React/);
  });

  it("instructions say: read only what the current unit needs; no broad read batching", () => {
    expect(FIRST_BUILD_TOOL_NOTE).toMatch(/read ONLY what that unit needs/);
    expect(FIRST_BUILD_TOOL_NOTE).toMatch(/do not list directories/);
    expect(FIRST_BUILD_TOOL_NOTE).not.toMatch(/request them ALL in one response/);
  });

  it("relevant multi-read in one step, then write — validated, progress recorded, no drift signal", async () => {
    seen = [];
    const traces: CallTrace[] = [];
    const r = await runToolLoop(base([
      reply(call("read_file", { path: "src/components/blocks/nav-bar.tsx" }), call("read_file", { path: "src/components/ui/container.tsx" })),
      reply(call("create_file", { path: "src/components/site-header.tsx", content: "export function SiteHeader() { return null }\n" })),
      reply(call("finish", {})),
    ], { onTrace: (t: CallTrace) => traces.push(t) }) as never);
    expect(r.outcome).toBe("finished");
    expect(traces[0]!.filesRead).toHaveLength(2);
    expect(traces[1]!.progress).toBe(true);
    expect(traces[1]!.validationFailures).toBe(0);
    expect(seen.join("")).not.toContain("You have enough context");
  });

  it("broad exploration across unrelated kit areas gets the drift signal before the no-progress stop", async () => {
    seen = [];
    const events: string[] = [];
    await runToolLoop(base([
      reply(call("list_files", { prefix: "src/components" })),
      reply(call("read_file", { path: "src/components/blocks/footer-minimal.tsx" })),
      reply(call("read_file", { path: "src/components/examples/form-contact.tsx" })),
      reply(call("create_file", { path: "src/components/site-header.tsx", content: "export function SiteHeader() { return null }\n" })),
      reply(call("finish", {})),
    ], { onEvent: (e: { kind: string }) => events.push(e.kind) }) as never);
    expect(events).toContain("exploration_drift");
    expect(events).not.toContain("no_progress_stop");
    expect(seen.join("")).toContain("You have enough context");
  });

  it("re-listing the same directory without a workspace change is answered as unchanged", async () => {
    seen = [];
    await runToolLoop(base([
      reply(call("list_files", { prefix: "src/components/blocks" })),
      reply(call("list_files", { prefix: "src/components/blocks" })),
      reply(call("finish", {})),
    ]) as never);
    expect(seen.join("")).toContain("Unchanged since you listed");
  });

  it("the no-progress stop is unchanged (still stops a run that never writes)", async () => {
    const replies = Array.from({ length: 12 }, (_, i) => reply(call("read_file", { path: i % 2 ? kit[0]!.path : kit[1]!.path })));
    const r = await runToolLoop(base(replies) as never);
    expect(r.outcome).toBe("no_progress");
  });

  it("drift detection is evidence-based: narrowing reads within one area are not drift", () => {
    const a = (tool: string, path: string, extra: Partial<ActionRecord> = {}): ActionRecord => ({ tool, path, key: `${tool}:${path}`, isError: false, miss: false, firstLine: "", ...extra });
    const explored = new Set<string>();
    expect(detectExplorationDrift(explored, [a("read_file", "src/components/blocks/nav-bar.tsx")], 1)).toBeNull();
    expect(detectExplorationDrift(explored, [a("read_file", "src/components/blocks/footer-minimal.tsx")], 2)).toBeNull();
    expect(detectExplorationDrift(explored, [a("read_file", "src/components/examples/form-contact.tsx")], 3)).toBe(EXPLORATION_DRIFT_SIGNAL);
  });
});

describe("build summary is saved on every terminal state (one finalization path)", () => {
  const sink = () => createTelemetrySink({ turnId: "t", projectId: "p" }, async () => async () => ({ error: null }), () => {});
  const run = async (turnId: string, loop: () => Promise<{ outcome: string }>) => {
    const traces: CallTrace[] = [];
    let summary: unknown = null;
    const res = await runWithExecutionSummary({ turnId, traces, turnStartedAt: Date.now(), stages: [], telemetry: sink(), onSummary: (s) => (summary = s) }, loop).catch((e) => e);
    return { res, summary: summary as { outcome: string; error: string | null } | null, taken: takeExecutionSummary(turnId) };
  };

  it("success", async () => {
    const r = await run("s1", async () => ({ outcome: "finished" }));
    expect(r.summary?.outcome).toBe("finished");
    expect(r.taken?.outcome).toBe("finished");
  });
  it("failed (loop incomplete)", async () => {
    expect((await run("s2", async () => ({ outcome: "incomplete" }))).taken?.outcome).toBe("incomplete");
  });
  it("no-progress stop", async () => {
    const r = await run("s3", async () => runToolLoop(base(Array.from({ length: 12 }, () => reply(call("read_file", { path: kit[0]!.path })))) as never));
    expect(r.taken?.outcome).toBe("no_progress");
  });
  it("cancellation", async () => {
    const r = await run("s4", async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    expect(r.res).toBeInstanceOf(Error);
    expect(r.taken?.outcome).toBe("cancelled");
  });
  it("provider/tool failure", async () => {
    const r = await run("s5", async () => { throw new Error("upstream 502"); });
    expect(r.taken).toMatchObject({ outcome: "error", error: "upstream 502" });
  });
  it("the failed-turn record in generate.ts includes the same summary", () => {
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).toContain("execution_summary: takeExecutionSummary(recorder.turnId)");
    expect(src).toContain("runWithExecutionSummary(");
    expect(src).not.toContain("summarizeExecution(loopTraces");
  });
});
