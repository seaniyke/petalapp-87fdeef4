import { describe, it, expect } from "vitest";
import { createTelemetrySink, traceRow, classifyCall, summarizeExecution } from "@/server/engine/loop-telemetry";
import { runToolLoop, type CallTrace, type ModelReply } from "@/server/engine/tool-loop";
import { scopeDbQuery } from "@/server/agent-db-scope";

const ids = { turnId: "turn-1", projectId: "proj-1" };

function trace(over: Partial<CallTrace> = {}): CallTrace {
  return {
    call: 1, startedAt: 1_000, durationMs: 4_000, ttftMs: 1_000, usage: { promptTokens: 1000, cachedTokens: 800, completionTokens: 300 },
    model: "m", toolCalls: ["create_file"], toolMs: 200, validationMs: 50, writes: 1, compacted: false, finishReason: "tool_calls",
    upstream: "ProviderX", workUnit: "page", writtenPaths: ["src/pages/Home.tsx"], progress: true,
    context: { system: 100, brief: 10, history: 5 }, outputTokensPerSec: 100, filesRead: [], knowledgeChars: 0,
    readMisses: 0, validationFailures: 0, toolErrors: 0, recovery: null, error: null, ...over,
  } as CallTrace;
}

describe("telemetry persistence", () => {
  it("a failing insert does not throw, is logged with turn/project/step, and is counted", async () => {
    const logs: string[] = [];
    const sink = createTelemetrySink(ids, async () => async () => ({ error: { message: "table_not_allowed" } }), (l) => logs.push(l));
    expect(() => sink.record(trace({ call: 3 }))).not.toThrow();
    await sink.flush();
    expect(sink.failures).toEqual([{ call: 3, error: "table_not_allowed" }]);
    const line = JSON.parse(logs[0]!);
    expect(line).toMatchObject({ event: "telemetry_persist_failed", turnId: "turn-1", projectId: "proj-1", call: 3, error: "table_not_allowed" });
    expect(sink.persisted).toBe(0);
  });

  it("a throwing client is also caught, logged and counted", async () => {
    const logs: string[] = [];
    const sink = createTelemetrySink(ids, async () => { throw new Error("no db"); }, (l) => logs.push(l));
    sink.record(trace({ call: 2 }));
    await sink.flush();
    expect(sink.failures[0]).toMatchObject({ call: 2, error: "no db" });
    expect(logs).toHaveLength(1);
  });

  it("the build loop finishes even when every telemetry write fails", async () => {
    const logs: string[] = [];
    const sink = createTelemetrySink(ids, async () => async () => ({ error: { message: "down" } }), (l) => logs.push(l));
    const replies: ModelReply[] = [
      { content: null, toolCalls: [{ id: "a", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "src/a.ts", content: "export const a = 1;\n" }) } }] },
      { content: null, toolCalls: [{ id: "b", type: "function", function: { name: "finish", arguments: "{}" } }] },
    ];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      callModel: async () => replies.shift()!,
      validate: async () => [],
      readiness: async () => ({ ready: true, findings: [] }),
      onTrace: (t) => sink.record(t),
    } as never);
    await sink.flush();
    expect(r.outcome).toBe("finished");
    expect(sink.failures.length).toBe(r.traces.length);
    expect(logs.every((l) => l.includes("turn-1") && l.includes("proj-1"))).toBe(true);
  });

  it("successful writes are counted", async () => {
    const rows: Record<string, unknown>[] = [];
    const sink = createTelemetrySink(ids, async () => async (row) => { rows.push(row); return { error: null }; });
    sink.record(trace());
    await sink.flush();
    expect(sink.persisted).toBe(1);
    expect(rows[0]).toMatchObject({ turn_id: "turn-1", call_no: 1, upstream_provider: "ProviderX", uncached_tokens: 200, call_class: "file_creation" });
    expect(rows[0]!.first_token_at).toBe(new Date(2_000).toISOString());
  });
});

describe("build-server gateway allows telemetry, pinned to the turn", () => {
  it("stamps turn, project and user; refuses other actions", () => {
    const s = { projectId: "P", userId: "U", turnId: "T" };
    const ok = scopeDbQuery({ op: "db.query", table: "tool_loop_calls", action: "insert", filters: [], values: { turn_id: "evil", project_id: "evil", call_no: 1 } }, s);
    expect("error" in ok).toBe(false);
    expect((ok as { values: Record<string, unknown> }).values).toMatchObject({ turn_id: "T", project_id: "P", user_id: "U" });
    const bad = scopeDbQuery({ op: "db.query", table: "tool_loop_calls", action: "select", filters: [] }, s);
    expect(bad).toEqual({ error: "action_not_allowed" });
  });
});

describe("classification and summary", () => {
  it("classifies calls deterministically", () => {
    expect(classifyCall(trace({ toolCalls: ["plan_tasks"], writtenPaths: [] }))).toBe("planning");
    expect(classifyCall(trace({ toolCalls: ["read_file"], writtenPaths: [], filesRead: ["knowledge/x.md"] }))).toBe("knowledge");
    expect(classifyCall(trace({ toolCalls: ["read_file"], writtenPaths: [], filesRead: ["src/a.ts"] }))).toBe("inspection");
    expect(classifyCall(trace({ toolCalls: ["finish"], writtenPaths: [] }))).toBe("completion");
    expect(classifyCall(trace({ recovery: "correction" }))).toBe("correction");
    expect(classifyCall(trace({ error: "502" }))).toBe("error");
  });

  it("summarizes time, tokens, providers and stages", () => {
    const s = summarizeExecution(
      [trace({ call: 1, startedAt: 10_000 }), trace({ call: 2, startedAt: 15_000, toolCalls: ["read_file"], writtenPaths: [], progress: false, filesRead: ["src/a.ts"] })],
      { turnStartedAt: 0, turnEndedAt: 25_000, stages: [{ name: "open", at: 0 }, { name: "pre_prd", at: 2_000 }], telemetry: { persisted: 2, failed: 0 } },
    );
    expect(s.totalMs).toBe(25_000);
    expect(s.loop.startMs).toBe(10_000);
    expect(s.loop.aiCalls).toBe(2);
    expect(s.stages).toEqual([{ name: "open", ms: 2_000 }, { name: "pre_prd", ms: 8_000 }]);
    expect(s.tokens.cacheHitRate).toBe(80);
    expect(s.providers).toEqual({ ProviderX: 2 });
    expect(s.classes).toEqual({ file_creation: 1, inspection: 1 });
    expect(s.filesPerCall).toBe(0.5);
  });

  it("row mapping has every required field", () => {
    const r = traceRow(trace(), ids);
    for (const k of ["turn_id", "project_id", "call_no", "work_unit", "model", "upstream_provider", "request_started_at", "first_token_at", "completed_at", "ttft_ms", "duration_ms", "completion_tokens", "output_tps", "prompt_tokens", "cached_tokens", "uncached_tokens", "system_chars", "brief_chars", "knowledge_chars", "history_chars", "files_read", "files_written", "tool_calls", "progress", "validation_failures", "recovery", "error"]) {
      expect(r).toHaveProperty(k);
    }
  });
});
