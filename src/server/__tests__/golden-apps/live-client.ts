/**
 * Track B — live model client.
 *
 * Stand-alone gateway call that bypasses the orchestrator. We do NOT use
 * `aiChatCompletions` from `ai-provider.server.ts` because that path:
 *   - writes telemetry rows into Supabase (needs admin client)
 *   - reads operator overrides from `ai_provider_settings`
 *   - applies fallback-model retries that conflate quality signals
 *
 * For an eval harness we want the *bare* model behaviour against a fixed
 * prompt. No retries, no rescue, no telemetry. The point of Track B is
 * to expose drift, not to hide it.
 */
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface LiveCallOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Tool-call schema (write_project / patch_files). */
  tool: Record<string, unknown>;
  /** Force the model to call this tool. */
  toolName: string;
  /** Cap completion tokens — prevents a runaway run. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LiveCallResult {
  ok: boolean;
  status: number;
  /** Parsed `write_project` payload, if the model called the tool. */
  toolArgs?: {
    plan?: string;
    summary?: string;
    files?: Array<{ path: string; content: string }>;
    recap?: string;
  };
  /** Raw assistant text, when the model replied with prose instead. */
  text?: string;
  /** Token usage as reported by the gateway. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** The reason we stopped — "tool_calls" / "stop" / "length" / etc. */
  finishReason?: string;
  /** Wall-clock latency in ms. */
  latencyMs: number;
  /** Error message when ok=false. */
  error?: string;
}

export async function callLiveModel(opts: LiveCallOptions): Promise<LiveCallResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      error: "LOVABLE_API_KEY is not set in the environment",
    };
  }

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
    tools: [opts.tool],
    tool_choice: { type: "function", function: { name: opts.toolName } },
    max_tokens: opts.maxTokens ?? 16000,
    // Deliberately NO `stream: true`. The harness wants the full response
    // in one shot — we're parsing tool arguments, not rendering tokens.
  };

  const t0 = Date.now();
  let resp: Response;
  try {
    resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const latencyMs = Date.now() - t0;

  const text = await resp.text();
  if (!resp.ok) {
    // 429 → rate limit, 402 → out of credits — surface as-is.
    return { ok: false, status: resp.status, latencyMs, error: text.slice(0, 500) };
  }

  let parsed: {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: LiveCallResult["usage"];
  };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      status: resp.status,
      latencyMs,
      error: `gateway returned non-JSON: ${text.slice(0, 200)}`,
    };
  }

  const choice = parsed.choices?.[0];
  const finishReason = choice?.finish_reason;
  const usage = parsed.usage;
  const toolCall = choice?.message?.tool_calls?.[0];

  if (toolCall?.function?.arguments) {
    try {
      const toolArgs = JSON.parse(toolCall.function.arguments);
      return {
        ok: true,
        status: resp.status,
        latencyMs,
        toolArgs,
        usage,
        finishReason,
      };
    } catch (err) {
      return {
        ok: false,
        status: resp.status,
        latencyMs,
        usage,
        finishReason,
        error: `tool arguments failed to JSON.parse — likely truncated by max_tokens (finish_reason=${finishReason})`,
      };
    }
  }

  // Model replied with prose instead of calling the tool. That's a quality
  // failure but not a transport failure — surface it.
  return {
    ok: false,
    status: resp.status,
    latencyMs,
    usage,
    finishReason,
    text: choice?.message?.content ?? undefined,
    error: `model did not call the tool (finish_reason=${finishReason})`,
  };
}

/**
 * Cost estimate per 1M tokens (USD). Hard-coded snapshot — keep small,
 * we only need order-of-magnitude for the dry-run print. Update when
 * gateway pricing materially changes.
 */
const PRICING_USD_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  "google/gemini-3-flash-preview": { in: 0.3, out: 2.5 },
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "google/gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "google/gemini-2.5-pro": { in: 1.25, out: 10 },
  "openai/gpt-5": { in: 1.25, out: 10 },
  "openai/gpt-5-mini": { in: 0.25, out: 2 },
  "openai/gpt-5-nano": { in: 0.05, out: 0.4 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICING_USD_PER_M_TOKENS[model] ?? { in: 1, out: 5 };
  return (
    (promptTokens / 1_000_000) * p.in +
    (completionTokens / 1_000_000) * p.out
  );
}

/** Heuristic per-call budget for the dry-run plan. Conservative on completion. */
export function estimatePlannedCostUsd(model: string): number {
  // ~5k prompt tokens (system + user), ~8k completion (write_project payload).
  return estimateCostUsd(model, 5000, 8000);
}
