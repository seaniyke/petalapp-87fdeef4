/**
 * AI provider abstraction.
 *
 * Every server-side AI call in Petal goes through `aiChatCompletions(...)`. The
 * helper picks a provider (Lovable AI by default, OpenRouter optional), picks a
 * model (DB override → caller-supplied → default), forwards the request as an
 * OpenAI-compatible chat completions call, and:
 *
 *   1. Records a telemetry row in `ai_call_log` (best-effort, never blocks).
 *   2. On a hard error (429/402/5xx) and only when the body has not yet been
 *      consumed, retries ONCE with the configured fallback model on the same
 *      provider. The retried response is what callers see.
 *
 * The caller gets back the raw `Response` so streaming code keeps working
 * without any change.
 *
 * How to switch providers:
 *   - Admin UI at /admin/ai-providers (per feature, with model picker).
 *   - DB override (ai_provider_settings) wins over env.
 *   - Env vars (AI_PROVIDER, AI_PROVIDER_GENERATE, etc.) still work.
 *
 * Image gen is HARD-PINNED to Lovable AI — Gemini's `message.images` shape
 * isn't portable to OpenRouter.
 */

export type AiFeature =
  | "generate"
  | "discuss"
  | "triage"
  | "coach"
  | "design"
  | "memory"
  | "recovery"
  | "preflight"
  | "image";

type Provider = "lovable" | "openrouter";

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function featureOverrideEnv(feature: AiFeature): string {
  return `AI_PROVIDER_${feature.toUpperCase()}`;
}

// ---------------- DB override cache ----------------

type FeatureSettings = {
  provider: Provider | null;
  model: string | null;
  fallback_model: string | null;
};

const CACHE_TTL_MS = 30_000;
let cachedSettings: Map<string, FeatureSettings> | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<Map<string, FeatureSettings>> | null = null;

async function loadDbSettings(): Promise<Map<string, FeatureSettings>> {
  const now = Date.now();
  if (cachedSettings && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("ai_provider_settings")
        .select("feature, provider, model, fallback_model");
      const map = new Map<string, FeatureSettings>();
      for (const row of (data ?? []) as Array<{
        feature: string;
        provider: string | null;
        model: string | null;
        fallback_model: string | null;
      }>) {
        map.set(row.feature, {
          provider:
            row.provider === "openrouter" || row.provider === "lovable"
              ? row.provider
              : null,
          model: row.model || null,
          fallback_model: row.fallback_model || null,
        });
      }
      cachedSettings = map;
      cacheLoadedAt = Date.now();
      return map;
    } catch (err) {
      console.warn("[ai-provider] failed to load DB settings, env-only", err);
      const map = new Map<string, FeatureSettings>();
      cachedSettings = map;
      cacheLoadedAt = Date.now();
      return map;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateProviderCache(): void {
  cachedSettings = null;
  cacheLoadedAt = 0;
}

// ---------------- Resolution ----------------

async function resolveProvider(feature: AiFeature): Promise<Provider> {
  if (feature === "image") return "lovable";

  const settings = await loadDbSettings();
  const dbChoice = settings.get(feature)?.provider;
  if (dbChoice) return dbChoice;

  const envOverride = process.env[featureOverrideEnv(feature)]?.toLowerCase();
  const envGlobal = process.env.AI_PROVIDER?.toLowerCase();
  const choice = envOverride || envGlobal || "lovable";
  return choice === "openrouter" ? "openrouter" : "lovable";
}

async function resolveModelOverride(
  feature: AiFeature,
): Promise<{ model: string | null; fallback: string | null }> {
  const settings = await loadDbSettings();
  const s = settings.get(feature);
  return {
    model: s?.model ?? null,
    fallback: s?.fallback_model ?? null,
  };
}

/**
 * Lovable-AI model slugs sometimes don't exist verbatim on OpenRouter. This
 * map covers our defaults; anything not listed forwards as-is (OpenRouter
 * accepts most `provider/model` slugs unchanged).
 */
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
  "google/gemini-2.5-flash": "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "google/gemini-2.5-pro",
  "openai/gpt-5": "openai/gpt-5",
  "openai/gpt-5-mini": "openai/gpt-5-mini",
  "openai/gpt-5-nano": "openai/gpt-5-nano",
};

function remapModelForOpenRouter(model: string | undefined): string | undefined {
  if (!model) return model;
  return OPENROUTER_MODEL_MAP[model] ?? model;
}

// ---------------- Telemetry ----------------

/**
 * Per-million-token USD price (rough, blended input+output) for the models we
 * route through the gateway. Used to populate `ai_call_log.cost_usd_micro` so
 * the admin dashboard shows a non-zero "Estimated cost" — the gateway doesn't
 * return a $ amount, only token counts. Prices are conservative averages of
 * OpenRouter list prices as of mid-2026; close enough for an internal
 * estimate, OpenRouter remains the source of truth for actual billing.
 */
const MODEL_PRICE_PER_M_TOKENS: Array<{ match: RegExp; inUsd: number; outUsd: number }> = [
  { match: /claude-(sonnet|opus)-4/i, inUsd: 3.0, outUsd: 15.0 },
  { match: /claude-haiku/i, inUsd: 0.8, outUsd: 4.0 },
  { match: /gpt-5(\.\d+)?-(nano|mini)/i, inUsd: 0.25, outUsd: 2.0 },
  { match: /gpt-5(\.\d+)?-pro/i, inUsd: 10.0, outUsd: 40.0 },
  { match: /gpt-5(\.\d+)?$/i, inUsd: 1.25, outUsd: 10.0 },
  { match: /gemini-(2\.5|3\.?\d?)-pro/i, inUsd: 1.25, outUsd: 5.0 },
  { match: /gemini-(2\.5|3\.?\d?)-flash-lite/i, inUsd: 0.1, outUsd: 0.4 },
  { match: /gemini-(2\.5|3\.?\d?)-flash/i, inUsd: 0.3, outUsd: 1.2 },
  { match: /deepseek/i, inUsd: 0.3, outUsd: 1.2 },
];

function estimateCostUsdMicro(
  model: string | null | undefined,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): number | null {
  if (!model) return null;
  const pin = promptTokens ?? 0;
  const pout = completionTokens ?? 0;
  if (pin <= 0 && pout <= 0) return null;
  const entry =
    MODEL_PRICE_PER_M_TOKENS.find((e) => e.match.test(model)) ??
    { inUsd: 0.5, outUsd: 2.0 }; // generic fallback
  const usd = (pin / 1_000_000) * entry.inUsd + (pout / 1_000_000) * entry.outUsd;
  return Math.round(usd * 1_000_000);
}


interface TelemetryArgs {
  feature: AiFeature;
  provider: Provider;
  model: string | null;
  status: number;
  latencyMs: number;
  fallbackUsed: boolean;
  errorMessage?: string | null;
  // Optional — populated for non-streaming responses where we peek the body.
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsdMicro?: number | null;
  // Tier 4 — router signals.
  phase?: string | null;
  promptChars?: number | null;
  hadAttachments?: boolean | null;
  chosenBy?: string | null;
}

async function recordTelemetry(args: TelemetryArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_call_log").insert({
      feature: args.feature,
      provider: args.provider,
      model: args.model,
      status: args.status,
      prompt_tokens: args.promptTokens ?? null,
      completion_tokens: args.completionTokens ?? null,
      total_tokens: args.totalTokens ?? null,
      cost_usd_micro: args.costUsdMicro ?? null,
      latency_ms: args.latencyMs,
      fallback_used: args.fallbackUsed,
      error_message: args.errorMessage ?? null,
      phase: args.phase ?? null,
      prompt_chars: args.promptChars ?? null,
      had_attachments: args.hadAttachments ?? false,
      chosen_by: args.chosenBy ?? null,
    });
  } catch (err) {
    // Never break the AI call because logging failed.
    console.warn("[ai-provider] telemetry insert failed", err);
  }
}

/**
 * Backfill token usage onto the most recent ai_call_log row for a given
 * feature/model. Called by streaming consumers (api/generate, api/discuss)
 * AFTER the SSE body has been drained — at that point we know how many
 * prompt/completion tokens the gateway reported in its final usage chunk,
 * but `recordTelemetry` already inserted the row with NULLs because it
 * fires the moment the upstream Response resolves (before the body is
 * read). Without this update every streaming call shows NULL tokens in
 * `ai_call_log`, which makes it impossible to tell whether the model
 * actually generated content or returned a one-line refusal.
 */
export async function updateLastCallUsage(args: {
  feature: AiFeature;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedPromptTokens?: number | null;
  staticPrefixChars?: number | null;
  staticPrefixHash?: string | null;
  filesSent?: number | null;
}): Promise<void> {
  if (!args.promptTokens && !args.completionTokens) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Find the most recent row for this feature+model in the last 5 minutes
    // (the row we just inserted from `aiChatCompletions`). Wider windows risk
    // updating a stale row from a previous call that genuinely had no usage.
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    let q = supabaseAdmin
      .from("ai_call_log")
      .select("id")
      .eq("feature", args.feature)
      .is("prompt_tokens", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (args.model) q = q.eq("model", args.model);
    const { data: rows } = await q;
    const id = rows?.[0]?.id;
    if (!id) return;
    const patch: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      cost_usd_micro?: number | null;
      cached_prompt_tokens?: number | null;
      static_prefix_chars?: number | null;
      static_prefix_hash?: string | null;
      files_sent?: number | null;
    } = {
      prompt_tokens: args.promptTokens,
      completion_tokens: args.completionTokens,
      total_tokens: args.totalTokens,
    };
    const cost = estimateCostUsdMicro(
      args.model,
      args.promptTokens,
      args.completionTokens,
    );
    if (cost != null) patch.cost_usd_micro = cost;
    if (args.cachedPromptTokens != null) patch.cached_prompt_tokens = args.cachedPromptTokens;
    if (args.staticPrefixChars != null) patch.static_prefix_chars = args.staticPrefixChars;
    if (args.staticPrefixHash != null) patch.static_prefix_hash = args.staticPrefixHash;
    if (args.filesSent != null) patch.files_sent = args.filesSent;
    await supabaseAdmin.from("ai_call_log").update(patch).eq("id", id);
  } catch (err) {
    console.warn("[ai-provider] usage backfill failed", err);
  }
}

/**
 * Mark the most recent streaming AI call as failed when the HTTP response
 * opened successfully but the body later timed out/errored while being read.
 * Without this, router telemetry sees status=200 and keeps choosing a model
 * that never actually completed the user's build.
 */
export async function markLastCallFailure(args: {
  feature: AiFeature;
  model: string | null;
  status: number;
  errorMessage: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    let q = supabaseAdmin
      .from("ai_call_log")
      .select("id")
      .eq("feature", args.feature)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    q = args.model ? q.eq("model", args.model) : q.is("model", null);
    const { data: rows } = await q;
    const id = rows?.[0]?.id;
    if (!id) return;
    await supabaseAdmin
      .from("ai_call_log")
      .update({
        status: args.status,
        error_message: args.errorMessage.slice(0, 500),
      })
      .eq("id", id);
  } catch (err) {
    console.warn("[ai-provider] failure backfill failed", err);
  }
}

// ---------------- Public API ----------------

export interface AiCallMeta {
  /** Tier 3 phase tag (implement / debug / refactor / plan / docs). */
  phase?: string | null;
  /** Length of the user's latest prompt in characters. */
  promptChars?: number | null;
  /** True when the latest user turn carried image attachments. */
  hadAttachments?: boolean | null;
  /** Who picked the model: "smart_router" | "phase_router" | "default" | … */
  chosenBy?: string | null;
}

/**
 * Per-call timeout tier:
 *  - "default": non-streaming JSON call (25s)
 *  - "stream": streaming call (120s) — covers normal generate/discuss turns
 *  - "stream_first_build": initial scaffold streams (240s) — first build of a
 *    project tends to emit many files in one turn; the 120s ceiling was
 *    cutting these off mid-stream. Caller must explicitly opt in.
 */
export type AiCallTimeoutTier = "default" | "stream" | "stream_first_build";

export interface AiCallOptions {
  feature: AiFeature;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  meta?: AiCallMeta;
  /** Optional timeout-tier override. Inferred from `body.stream` when omitted. */
  timeoutTier?: AiCallTimeoutTier;
}

/**
 * Make an OpenAI-compatible chat completions call against the resolved provider.
 *
 * Returns the raw `Response`. For non-2xx responses we attempt ONE fallback
 * retry (same provider, fallback model from DB) before returning to the caller.
 *
 * Telemetry is recorded for both attempts. Streaming callers see no behaviour
 * change — we only inspect the response *status* before deciding to retry.
 */
export async function aiChatCompletions(opts: AiCallOptions): Promise<Response> {
  const provider = await resolveProvider(opts.feature);
  const { model: dbModel, fallback } = await resolveModelOverride(opts.feature);

  // DB model wins over caller-supplied model (operator overrides have priority).
  const callerModel = (opts.body.model as string | undefined) ?? undefined;
  let primaryModel = dbModel || callerModel || null;

  // Kill-switch: if the primary model is currently cooling off because of a
  // high `no_edit_emitted` rate, swap it for the configured fallback BEFORE
  // we make the call. Prevents the "every turn keeps hitting the same broken
  // model" loop until the cool-off window expires.
  const { isModelKilled } = await import("@/server/model-kill-switch.server");
  if (
    primaryModel &&
    isModelKilled(primaryModel) &&
    fallback &&
    !isModelKilled(fallback)
  ) {
    console.warn(
      `[kill-switch] swapping primary ${primaryModel} → ${fallback} (cooling off)`,
    );
    primaryModel = fallback;
  }

  const body =
    primaryModel && primaryModel !== callerModel
      ? { ...opts.body, model: primaryModel }
      : opts.body;

  const t0 = Date.now();
  const primary = await dispatch(provider, body, opts.signal, opts.timeoutTier);
  const latency = Date.now() - t0;

  // Decide whether to retry on fallback model (same provider).
  // Retry on 5xx, 429 (rate-limit), 402 (credits), AND 400/404 — the latter
  // catches "invalid model slug" / "model not found" so a typo in the admin
  // override doesn't burn 100% of that feature's calls.
  const shouldRetry =
    !primary.ok &&
    fallback &&
    fallback !== primaryModel &&
    (primary.status === 429 ||
      primary.status === 402 ||
      primary.status === 400 ||
      primary.status === 404 ||
      primary.status >= 500);

  if (!shouldRetry) {
    // Fire-and-forget telemetry; do NOT await — keep latency tight.
    void recordTelemetry({
      feature: opts.feature,
      provider,
      model: primaryModel,
      status: primary.status,
      latencyMs: latency,
      fallbackUsed: false,
      errorMessage: primary.ok ? null : `HTTP ${primary.status}`,
      phase: opts.meta?.phase ?? null,
      promptChars: opts.meta?.promptChars ?? null,
      hadAttachments: opts.meta?.hadAttachments ?? false,
      chosenBy: opts.meta?.chosenBy ?? null,
    });
    return primary;
  }

  // Drain the failed response so we can safely discard it.
  try {
    await primary.text();
  } catch {
    /* ignore */
  }

  void recordTelemetry({
    feature: opts.feature,
    provider,
    model: primaryModel,
    status: primary.status,
    latencyMs: latency,
    fallbackUsed: false,
    errorMessage: `Primary failed HTTP ${primary.status}, retrying with fallback`,
    phase: opts.meta?.phase ?? null,
    promptChars: opts.meta?.promptChars ?? null,
    hadAttachments: opts.meta?.hadAttachments ?? false,
    chosenBy: opts.meta?.chosenBy ?? null,
  });

  const fallbackBody = { ...opts.body, model: fallback };
  const t1 = Date.now();
  const retried = await dispatch(provider, fallbackBody, opts.signal, opts.timeoutTier);
  const retryLatency = Date.now() - t1;

  void recordTelemetry({
    feature: opts.feature,
    provider,
    model: fallback,
    status: retried.status,
    latencyMs: retryLatency,
    fallbackUsed: true,
    errorMessage: retried.ok ? null : `HTTP ${retried.status}`,
    phase: opts.meta?.phase ?? null,
    promptChars: opts.meta?.promptChars ?? null,
    hadAttachments: opts.meta?.hadAttachments ?? false,
    chosenBy: opts.meta?.chosenBy ?? null,
  });

  return retried;
}

/**
 * Default per-request timeouts. The Cloudflare Worker has a hard CPU/wall
 * budget; an upstream that hangs WILL kill the worker and produce an empty
 * response (status 0 in CF logs → "Something went wrong" in the UI). Every
 * AI call MUST be bounded.
 *
 * - Non-streaming: 25s. Plenty for short tool calls (classifier, director,
 *   self-check, autofix) but well under the worker's wall budget.
 * - Streaming: 120s. The big generate/discuss calls stream back and we
 *   forward bytes as they arrive, so the worker doesn't burn CPU while
 *   waiting. Still bounded so a wedged stream can't run forever.
 *
 * If the caller passes its own `signal`, we honor BOTH — whichever fires
 * first wins (AbortSignal.any is supported in Workers + Node ≥ 20).
 */
const DEFAULT_TIMEOUT_MS = 25_000;
/**
 * Hard wall-clock ceiling for streamed turns. This is a safety net for the
 * pathological case where the upstream never responds at all — in normal
 * operation the per-turn idle-timeout watchdog in `relayAndCollect` is what
 * actually catches a wedged provider, and lets in-progress streams that
 * keep emitting bytes run to completion.
 *
 * 120s was killing legitimate edit turns mid-stream (deep-reasoning models
 * with non-trivial file context routinely take 90–150s to finish). Raising
 * this to 240s — same as first build — closes the gap without inflating
 * the recovery window for genuinely hung providers (the idle watchdog
 * cancels those in 75s regardless of this value).
 */
const DEFAULT_STREAM_TIMEOUT_MS = 240_000;
/** Initial scaffolds get the same ceiling. Kept named for clarity. */
const FIRST_BUILD_STREAM_TIMEOUT_MS = 240_000;

function effectiveSignal(
  caller: AbortSignal | undefined,
  tier: AiCallTimeoutTier,
): AbortSignal {
  const ms =
    tier === "stream_first_build"
      ? FIRST_BUILD_STREAM_TIMEOUT_MS
      : tier === "stream"
        ? DEFAULT_STREAM_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(ms);
  if (!caller) return timeout;
  return AbortSignal.any([caller, timeout]);
}

async function dispatch(
  provider: Provider,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  tierOverride?: AiCallTimeoutTier,
): Promise<Response> {
  let url: string;
  let apiKey: string | undefined;
  let outBody = body;

  if (provider === "openrouter") {
    url = OPENROUTER_URL;
    apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not configured. Either add the secret or set the feature back to 'lovable'.",
      );
    }
    const remapped = remapModelForOpenRouter(outBody.model as string | undefined);
    if (remapped !== outBody.model) {
      outBody = { ...outBody, model: remapped };
    }
  } else {
    url = LOVABLE_URL;
    apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY is not configured.");
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER || "https://buildwithpetal.com";
    headers["X-Title"] = "Petal";
  }

  const isStreaming = outBody.stream === true;
  const tier: AiCallTimeoutTier =
    tierOverride ?? (isStreaming ? "stream" : "default");

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(outBody),
    signal: effectiveSignal(signal, tier),
  });
}

/** Diagnostics: returns the resolved provider for a given feature. */
export async function currentProviderFor(feature: AiFeature): Promise<Provider> {
  return resolveProvider(feature);
}

/** Diagnostics: snapshot of the resolved model for a feature (DB-only). */
export async function currentModelFor(
  feature: AiFeature,
): Promise<{ model: string | null; fallback: string | null }> {
  return resolveModelOverride(feature);
}

export const ALL_AI_FEATURES: AiFeature[] = [
  "generate",
  "discuss",
  "triage",
  "coach",
  "design",
  "memory",
  "recovery",
  "preflight",
  "image",
];
