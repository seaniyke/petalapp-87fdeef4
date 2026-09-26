/**
 * Adapter: one streamed OpenAI-format chat completion → the tool loop's
 * ModelReply. The transport (`send`) is injected so provider policy,
 * bounded retries and accounting stay where they already live.
 */
import type { CallModel, ModelReply, ToolCallMsg } from "./tool-loop";
import { InfrastructureFailure } from "@/lib/failure-classification";

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export async function parseToolStream(res: Response, startedAt: number): Promise<ModelReply & { rawUsage: RawUsage | null }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finishReason: string | null = null;
  let model: string | undefined;
  let rawUsage: RawUsage | null = null;
  let ttftMs: number | undefined;
  const calls = new Map<number, ToolCallMsg>();
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new InfrastructureFailure(`provider stream error: ${j.error.message ?? JSON.stringify(j.error)}`, j.error.code ?? null);
    if (j.model) model = j.model;
    if (j.usage) rawUsage = j.usage;
    const ch = j.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) finishReason = ch.finish_reason;
    const d = ch.delta ?? {};
    if ((d.content || d.tool_calls) && ttftMs === undefined) ttftMs = Date.now() - startedAt;
    if (typeof d.content === "string") content += d.content;
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const cur = calls.get(i) ?? { id: tc.id ?? `call_${i}`, type: "function" as const, function: { name: "", arguments: "" } };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      calls.set(i, cur);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf.trim());
  const u = rawUsage as RawUsage | null;
  return {
    content: content || null,
    toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter((c) => c.function.name),
    usage: u ? { promptTokens: u.prompt_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 } : undefined,
    ttftMs,
    finishReason,
    model,
    rawUsage,
  };
}

/** Build a CallModel from a transport. Non-OK responses are infrastructure failures. */
export function makeCallModel(
  send: (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response>,
  onUsage?: (u: RawUsage | null) => void,
): CallModel {
  return async (messages, tools, signal) => {
    const startedAt = Date.now();
    const res = await send({ messages, tools, tool_choice: "auto", parallel_tool_calls: true, stream: true, stream_options: { include_usage: true } }, signal);
    if (!res.ok || !res.body) throw new InfrastructureFailure(`AI provider returned HTTP ${res.status}`, res.status);
    const reply = await parseToolStream(res, startedAt);
    onUsage?.(reply.rawUsage);
    return reply;
  };
}
