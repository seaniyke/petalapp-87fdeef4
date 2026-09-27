/**
 * Per-step execution telemetry for the tool loop: row mapping, reliable
 * non-blocking persistence, and the per-build execution summary.
 *
 * Persistence never throws into the build, but a failure can never vanish:
 * every failure is logged as one structured line (turn/project/step/error)
 * AND counted on the returned sink, which the caller stores on the turn's
 * economics record. Pure except for the injected insert + logger.
 */
import type { CallTrace } from "./tool-loop";
import { KNOWLEDGE_DIR } from "./first-build-context";

export type CallClass =
  | "planning"
  | "file_creation"
  | "edit"
  | "inspection"
  | "knowledge"
  | "correction"
  | "completion"
  | "tool_only"
  | "error";

/** Deterministic classification of one AI step from what it actually did. */
export function classifyCall(t: CallTrace): CallClass {
  if (t.error) return "error";
  const tools = t.toolCalls;
  if (tools.includes("finish")) return "completion";
  if (t.writtenPaths.length) {
    if (t.recovery === "correction") return "correction";
    return tools.every((n) => n === "edit_file") ? "edit" : "file_creation";
  }
  if (tools.length && tools.every((n) => n === "plan_tasks")) return "planning";
  if (tools.length && tools.every((n) => n === "read_file" || n === "list_files" || n === "search")) {
    return t.filesRead.length && t.filesRead.every((p) => p.startsWith(`${KNOWLEDGE_DIR}/`)) ? "knowledge" : "inspection";
  }
  if (t.toolErrors > 0 || t.validationFailures > 0) return "correction";
  return "tool_only";
}

export interface TelemetryIds {
  turnId: string | null;
  projectId: string | null;
}

export function traceRow(t: CallTrace, ids: TelemetryIds): Record<string, unknown> {
  const prompt = t.usage?.promptTokens ?? null;
  const cached = t.usage?.cachedTokens ?? null;
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
  return {
    turn_id: ids.turnId,
    project_id: ids.projectId,
    call_no: t.call,
    work_unit: t.workUnit,
    call_class: classifyCall(t),
    model: t.model,
    upstream_provider: t.upstream,
    request_started_at: iso(t.startedAt),
    first_token_at: iso(t.ttftMs == null ? null : t.startedAt + t.ttftMs),
    completed_at: iso(t.startedAt + t.durationMs),
    system_chars: t.context.system,
    brief_chars: t.context.brief,
    history_chars: t.context.history,
    knowledge_chars: t.knowledgeChars,
    prompt_tokens: prompt,
    cached_tokens: cached,
    uncached_tokens: prompt == null ? null : Math.max(0, prompt - (cached ?? 0)),
    completion_tokens: t.usage?.completionTokens ?? null,
    ttft_ms: t.ttftMs,
    duration_ms: t.durationMs,
    output_tps: t.outputTokensPerSec,
    tool_ms: t.toolMs,
    validation_ms: t.validationMs,
    tool_calls: t.toolCalls,
    files_read: t.filesRead,
    files_written: t.writtenPaths,
    read_misses: t.readMisses,
    validation_failures: t.validationFailures,
    tool_errors: t.toolErrors,
    progress: t.progress,
    recovery: t.recovery,
    error: t.error,
    compacted: t.compacted,
    finish_reason: t.finishReason,
  };
}

export type InsertFn = (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null } | null | undefined>;
export type TelemetryLogger = (line: string) => void;

export interface TelemetryFailure {
  call: number;
  error: string;
}

export interface TelemetrySink {
  /** Fire-and-forget: never throws, never blocks the loop. */
  record(t: CallTrace): void;
  /** Resolves when every in-flight write has settled (for end-of-turn reporting). */
  flush(): Promise<void>;
  readonly persisted: number;
  readonly failures: TelemetryFailure[];
}

export function createTelemetrySink(ids: TelemetryIds, insert: () => Promise<InsertFn>, log: TelemetryLogger = (l) => console.error(l)): TelemetrySink {
  const pending = new Set<Promise<void>>();
  const failures: TelemetryFailure[] = [];
  let persisted = 0;
  const fail = (call: number, error: unknown) => {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
    failures.push({ call, error: message });
    log(JSON.stringify({ event: "telemetry_persist_failed", table: "tool_loop_calls", turnId: ids.turnId, projectId: ids.projectId, call, error: message }));
  };
  return {
    record(t) {
      let row: Record<string, unknown>;
      try {
        row = traceRow(t, ids);
      } catch (e) {
        fail(t.call, e);
        return;
      }
      const p = (async () => {
        try {
          const ins = await insert();
          const r = await ins(row);
          if (r && r.error) fail(t.call, r.error.message);
          else persisted++;
        } catch (e) {
          fail(t.call, e);
        }
      })();
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
    async flush() {
      await Promise.allSettled([...pending]);
    },
    get persisted() {
      return persisted;
    },
    failures,
  };
}

/* ------------------------------------------------------------------ */
/* Execution summary                                                   */
/* ------------------------------------------------------------------ */

export interface StageMark {
  name: string;
  at: number;
}

const pct = (xs: number[], p: number): number | null => {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export interface ExecutionSummary {
  totalMs: number | null;
  stages: Array<{ name: string; ms: number }>;
  loop: {
    startMs: number | null;
    wallMs: number;
    aiCalls: number;
    aiMs: number;
    ttftMs: number;
    generationMs: number;
    toolMs: number;
    validationMs: number;
    orchestrationMs: number;
  };
  ttft: { avg: number | null; p50: number | null; p90: number | null };
  outputTps: { avg: number | null; p50: number | null; p90: number | null };
  tokens: { prompt: number; cached: number; uncached: number; completion: number; cacheHitRate: number | null; avgPromptPerCall: number | null };
  context: { systemChars: number | null; briefChars: number | null; maxHistoryChars: number; knowledgeChars: number };
  filesWritten: number;
  filesPerCall: number | null;
  progressCalls: number;
  progressPerCall: number | null;
  classes: Record<string, number>;
  noOpCalls: number;
  providers: Record<string, number>;
  models: Record<string, number>;
  planning: { calls: number; ms: number };
  telemetry: { persisted: number; failed: number };
}

export function summarizeExecution(
  traces: CallTrace[],
  opts: { turnStartedAt?: number | null; turnEndedAt?: number | null; stages?: StageMark[]; telemetry?: { persisted: number; failed: number } } = {},
): ExecutionSummary {
  const tally = (key: (t: CallTrace) => string | null) => {
    const out: Record<string, number> = {};
    for (const t of traces) {
      const k = key(t) ?? "unknown";
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const sum = (f: (t: CallTrace) => number) => traces.reduce((n, t) => n + f(t), 0);
  const first = traces[0];
  const last = traces[traces.length - 1];
  const wallMs = first && last ? last.startedAt + last.durationMs + last.toolMs - first.startedAt : 0;
  const aiMs = sum((t) => t.durationMs);
  const toolMs = sum((t) => t.toolMs);
  const validationMs = sum((t) => t.validationMs);
  const ttftMs = sum((t) => t.ttftMs ?? 0);
  const prompt = sum((t) => t.usage?.promptTokens ?? 0);
  const cached = sum((t) => t.usage?.cachedTokens ?? 0);
  const classes = tally((t) => classifyCall(t));
  const written = new Set(traces.flatMap((t) => t.writtenPaths)).size;
  const progressCalls = traces.filter((t) => t.progress).length;
  const ttfts = traces.map((t) => t.ttftMs).filter((x): x is number => x != null);
  const tps = traces.map((t) => t.outputTokensPerSec).filter((x): x is number => x != null && x < 1000);
  const stages = opts.stages ?? [];
  const end = opts.turnEndedAt ?? null;
  const start = opts.turnStartedAt ?? stages[0]?.at ?? null;
  const planning = traces.filter((t) => classifyCall(t) === "planning");
  return {
    totalMs: start != null && end != null ? end - start : null,
    stages: stages.map((s, i) => ({ name: s.name, ms: (stages[i + 1]?.at ?? first?.startedAt ?? end ?? s.at) - s.at })),
    loop: {
      startMs: start != null && first ? first.startedAt - start : null,
      wallMs,
      aiCalls: traces.length,
      aiMs,
      ttftMs,
      generationMs: aiMs - ttftMs,
      toolMs,
      validationMs,
      orchestrationMs: Math.max(0, wallMs - aiMs - toolMs),
    },
    ttft: { avg: avg(ttfts), p50: pct(ttfts, 50), p90: pct(ttfts, 90) },
    outputTps: { avg: avg(tps), p50: pct(tps, 50), p90: pct(tps, 90) },
    tokens: {
      prompt,
      cached,
      uncached: prompt - cached,
      completion: sum((t) => t.usage?.completionTokens ?? 0),
      cacheHitRate: prompt ? Math.round((cached / prompt) * 1000) / 10 : null,
      avgPromptPerCall: traces.length ? Math.round(prompt / traces.length) : null,
    },
    context: {
      systemChars: first?.context.system ?? null,
      briefChars: first?.context.brief ?? null,
      maxHistoryChars: Math.max(0, ...traces.map((t) => t.context.history)),
      knowledgeChars: sum((t) => t.knowledgeChars),
    },
    filesWritten: written,
    filesPerCall: traces.length ? Math.round((written / traces.length) * 100) / 100 : null,
    progressCalls,
    progressPerCall: traces.length ? Math.round((progressCalls / traces.length) * 100) / 100 : null,
    classes,
    noOpCalls: traces.filter((t) => !t.progress && !t.toolCalls.length && !t.error).length,
    providers: tally((t) => t.upstream),
    models: tally((t) => t.model),
    planning: { calls: planning.length, ms: planning.reduce((n, t) => n + t.durationMs, 0) },
    telemetry: opts.telemetry ?? { persisted: 0, failed: 0 },
  };
}
