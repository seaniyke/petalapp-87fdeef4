import rawBudgetModelCatalog from "@/lib/openrouter-budget-models.json";
import {
  OPENROUTER_CHAT_URL,
  UTILITY_MAX_OUTPUT_TOKENS,
  coerceToConfiguredModel,
  defaultFallbackModel,
  defaultTextModel,
  defaultUtilityModel,
  isUtilityFeature,
} from "@/lib/ai-model-config";

import { codegenProviderRouting, resolveProviderRouting } from "@/server/engine/provider-policy";
export { codegenProviderRouting };

/**
 * AI provider abstraction — OPENROUTER ONLY.
 *
 *     Kimble  →  OpenRouter  →  DeepSeek
 *
 * Every server-side AI call in Kimble goes through `aiChatCompletions(...)`.
 * The helper resolves the model through the central config
 * (`src/lib/ai-model-config.ts`), forwards the request as an OpenAI-compatible
 * chat completions call to OpenRouter, and:
 *
 *   1. Records a telemetry row in `ai_call_log` (best-effort, never blocks) with
 *      model, provider, token counts, cost, user/project/turn ids.
 *   2. On a hard error (429/402/400/404/5xx) and only when the body has not yet
 *      been consumed, retries EXACTLY ONCE with the fallback model. There is no
 *      cross-provider failover, so one operation never fans out to two gateways.
 *
 * The caller gets back the raw `Response` so streaming code keeps working
 * without any change.
 *
 * There are no direct model-provider integrations (OpenAI, Anthropic, Google,
 * DeepSeek first-party) and no Lovable AI Gateway chat path. Model ids supplied
 * by callers or by legacy DB overrides are coerced to the configured DeepSeek
 * model; `openrouter/auto` is never used.
 *
 * To change the model everywhere: edit src/lib/ai-model-config.ts (or set
 * OPENROUTER_MODEL / OPENROUTER_VISION_MODEL / OPENROUTER_FALLBACK_MODEL).
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

/** Retained as a one-member union: OpenRouter is the only gateway. */
type Provider = "openrouter";

const OPENROUTER_URL = OPENROUTER_CHAT_URL;

/** True when the request carries image parts (vision models required). */
function requestHasImageParts(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    const content = (m as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const type = (part as { type?: unknown } | null)?.type;
      if (type === "image_url" || type === "input_image" || type === "image") return true;
    }
  }
  return false;
}

function featureOverrideEnv(feature: AiFeature): string {
  return `AI_PROVIDER_${feature.toUpperCase()}`;
}

export interface BudgetModel {
  id: string;
  name: string;
  context: number;
  vision: boolean;
  tools: boolean;
  inputUsdPerM: number;
  outputUsdPerM: number;
  features: AiFeature[];
}

export const BUDGET_MODELS: BudgetModel[] = rawBudgetModelCatalog as BudgetModel[];

/** Which budget models are eligible for a given feature. */
export function getBudgetModelsForFeature(feature: AiFeature): BudgetModel[] {
  return BUDGET_MODELS.filter((m) => m.features.includes(feature));
}

/** Default budget pick per feature; prefers the first model that supports the feature. */
export function defaultBudgetModelForFeature(feature: AiFeature): string | undefined {
  return getBudgetModelsForFeature(feature)[0]?.id;
}

function isVisionHeavy(messages: unknown[]): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    if (typeof m !== "object" || m === null) return false;
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) return false;
    return content.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "image_url",
    );
  });
}

function pickBudgetModelForFeature(
  feature: AiFeature,
  messages: unknown[],
  allowed?: string[] | null,
): string | undefined {
  const candidates = allowed && allowed.length > 0
    ? BUDGET_MODELS.filter((m) => allowed.includes(m.id))
    : getBudgetModelsForFeature(feature);
  if (candidates.length === 0) return undefined;
  const needsVision = isVisionHeavy(messages);
  // Prefer vision-capable budget models when the request has images.
  const visionFirst = [...candidates].sort((a, b) => {
    const aOk = a.vision === needsVision || a.vision;
    const bOk = b.vision === needsVision || b.vision;
    return Number(bOk) - Number(aOk);
  });
  return visionFirst[0]?.id;
}

type FeatureSettings = {
  provider: Provider | null;
  model: string | null;
  fallback_model: string | null;
  budget_enabled: boolean | null;
  budget_models: string[] | null;
  shadow_pct: number | null;
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
        .select("feature, provider, model, fallback_model, budget_enabled, budget_models, shadow_pct");
      const map = new Map<string, FeatureSettings>();
      for (const row of (data ?? []) as Array<{
        feature: string;
        provider: string | null;
        model: string | null;
        fallback_model: string | null;
        budget_enabled: boolean | null;
        budget_models: string[] | null;
        shadow_pct: number | null;
      }>) {
        map.set(row.feature, {
          // Legacy rows may say "lovable"; OpenRouter is the only gateway now.
          provider: row.provider === "openrouter" ? "openrouter" : null,
          model: row.model || null,
          fallback_model: row.fallback_model || null,
          budget_enabled: row.budget_enabled ?? null,
          budget_models: row.budget_models ?? null,
          shadow_pct: row.shadow_pct ?? null,
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

/**
 * OPENROUTER-ONLY. Kimble has a single AI provider: OpenRouter.
 *
 * Legacy DB rows (`ai_provider_settings.provider = 'lovable'`) and legacy env
 * vars (`AI_PROVIDER`, `AI_PROVIDER_<FEATURE>`) are intentionally ignored so a
 * stale configuration row cannot silently re-open a direct-provider path.
 */
async function resolveProvider(_feature: AiFeature): Promise<Provider> {
  return "openrouter";
}

/** Public: resolve which provider a given feature is configured to use.
 *  Used by image-generation.server.ts to pick the right gateway URL/key. */
export async function getProviderForFeature(feature: AiFeature): Promise<Provider> {
  return resolveProvider(feature);
}

/** Load a user's economy-mode preference from their profile. */
export async function getUserEconomyMode(userId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("economy_mode")
      .eq("id", userId)
      .single();
    if (error || !data) return false;
    return data.economy_mode ?? false;
  } catch (err) {
    console.warn("[economy] failed to load user economy mode:", err);
    return false;
  }
}

export interface BudgetConfig {
  enabled: boolean;
  allowedModels: string[];
  shadowPct: number;
  defaultModel: string | undefined;
}

export async function getBudgetConfigForFeature(feature: AiFeature): Promise<BudgetConfig> {
  const settings = await loadDbSettings();
  const s = settings.get(feature);
  const enabled = s?.budget_enabled ?? true;
  const allowedModels = s?.budget_models && s.budget_models.length > 0
    ? s.budget_models
    : getBudgetModelsForFeature(feature).map((m) => m.id);
  const shadowPct = s?.shadow_pct ?? 0;
  return {
    enabled,
    allowedModels,
    shadowPct,
    defaultModel: defaultBudgetModelForFeature(feature),
  };
}

/** Pick a budget model for a request if the feature allows it. */
export async function resolveBudgetModel(
  feature: AiFeature,
  messages: unknown[],
): Promise<string | undefined> {
  const cfg = await getBudgetConfigForFeature(feature);
  if (!cfg.enabled || cfg.allowedModels.length === 0) return undefined;
  return pickBudgetModelForFeature(feature, messages, cfg.allowedModels);
}

/** Decide whether to shadow-route to budget models for A/B testing. */
export async function shouldShadowBudget(feature: AiFeature): Promise<boolean> {
  const cfg = await getBudgetConfigForFeature(feature);
  if (!cfg.enabled || cfg.allowedModels.length === 0) return false;
  if (cfg.shadowPct <= 0) return false;
  if (cfg.shadowPct >= 100) return true;
  const roll = Math.random() * 100;
  return roll < cfg.shadowPct;
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
  // OpenAI — `openai/gpt-5` is NOT a live slug on our gateway. Telemetry:
  // 107 calls, 107 errors (100%), ~358ms each. Every one of those was silently
  // absorbed by the fallback chain, so it never surfaced as an incident while
  // still costing a wasted round-trip on every heavy generate. The whole
  // heavy-tier family now routes to a model with proven production numbers
  // (claude-sonnet-4.5: 501 calls, 1 error).
  "openai/gpt-5": "anthropic/claude-sonnet-4.5",
  "openai/gpt-5-mini": "openai/gpt-5-mini",
  "openai/gpt-5-nano": "openai/gpt-5-nano",
  "openai/gpt-5.2": "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.4": "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.4-mini": "openai/gpt-5-mini",
  "openai/gpt-5.4-nano": "openai/gpt-5-nano",
  "openai/gpt-5.4-pro": "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.5": "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.5-pro": "anthropic/claude-sonnet-4.5",
  // Anthropic — only reachable via OpenRouter today. Used by curated-briefs
  // and (soon) the smart-router as candidates for implement/debug phases.
  "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5": "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
};

/**
 * Model ids that are known-dead on the gateway. Anything landing here is a
 * configuration mistake (usually an admin override or a stale constant), not a
 * transient outage — the fallback chain hides it, so we log loudly instead of
 * letting it rot for another 169 wasted calls.
 */
const DEAD_MODEL_IDS = new Set(["openai/gpt-5"]);

export function isDeadModelId(model: string | null | undefined): boolean {
  return !!model && DEAD_MODEL_IDS.has(model);
}

/**
 * Every model id we consider "known" — the remap table's keys and targets.
 * `model-health.server.ts` also treats the budget catalog as known. An id
 * outside both sets is a typo or a stale admin override and gets flagged.
 */
export const KNOWN_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(OPENROUTER_MODEL_MAP),
  ...Object.values(OPENROUTER_MODEL_MAP),
  "google/gemini-2.5-flash-image",
  // Active utility model (DEFAULT_UTILITY_MODEL); was missing, so every
  // health pass flagged a working model as a typo.
  "deepseek/deepseek-v4-flash-0731",
]);


function remapModelForOpenRouter(model: string | undefined): string | undefined {
  if (!model) return model;
  const mapped = OPENROUTER_MODEL_MAP[model] ?? model;
  if (DEAD_MODEL_IDS.has(mapped)) {
    console.error(
      `[ai-provider] configured model "${model}" resolves to dead slug "${mapped}" — this call will fail and fall back. Fix the model configuration.`,
    );
  }
  return mapped;
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
  // Budget-tier OpenRouter models (as of mid-2026, used when economy mode is on).
  { match: /qwen\/qwen3\.7-flash/i, inUsd: 0.03, outUsd: 0.13 },
  { match: /openai\/gpt-oss-20b/i, inUsd: 0.03, outUsd: 0.13 },
  { match: /meta-llama\/llama-3\.1-8b-instruct/i, inUsd: 0.05, outUsd: 0.08 },
  { match: /poolside\/laguna-xs-2\.1/i, inUsd: 0.06, outUsd: 0.12 },
  { match: /mistralai\/mistral-nemo/i, inUsd: 0.02, outUsd: 0.03 },
  { match: /google\/gemma-3-12b-it/i, inUsd: 0.05, outUsd: 0.15 },
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
  // P1-5 — per-project / per-user attribution.
  projectId?: string | null;
  userId?: string | null;
  /** Economics: links this call to the user turn that caused it. */
  turnId?: string | null;
}

/** Full provider-reported usage for one call. NULL fields mean UNKNOWN, never 0. */
export interface ParsedUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Normalise an OpenRouter/OpenAI-shaped `usage` object. */
export function parseUsageObject(u: unknown): ParsedUsage | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const pd = (o.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cd = (o.completion_tokens_details ?? {}) as Record<string, unknown>;
  const parsed: ParsedUsage = {
    promptTokens: num(o.prompt_tokens),
    completionTokens: num(o.completion_tokens),
    totalTokens: num(o.total_tokens),
    cachedTokens: num(pd.cached_tokens) ?? num(o.cache_read_input_tokens) ?? num(o.prompt_cache_hit_tokens),
    cacheWriteTokens: num(pd.cache_write_tokens) ?? num(o.cache_creation_input_tokens),
    reasoningTokens: num(cd.reasoning_tokens),
    costUsd: num(o.cost),
  };
  if (parsed.promptTokens == null && parsed.completionTokens == null) return null;
  return parsed;
}

/**
 * Read a non-streamed body exactly once and return an equivalent Response
 * whose body has not been consumed. A body read failure yields a clean 502
 * Response instead of an unhandled exception downstream.
 */
export async function bufferedResponse(resp: Response): Promise<Response> {
  if (!resp.body) return resp;
  let text: string;
  try {
    text = await resp.text();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: { message: `response body unreadable: ${e instanceof Error ? e.message : String(e)}` } }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(text, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
}

/**
 * Read `usage` out of a NON-STREAMED gateway response without consuming the
 * body the caller still needs. Streamed responses are metered by
 * `meterStream`, which parses the final SSE usage chunk in-flight.
 */
async function usageFromResponse(
  resp: Response,
  body: Record<string, unknown>,
): Promise<(ParsedUsage & { requestId: string | null; upstream: string | null }) | null> {
  if (body.stream === true) return null;
  if (!resp.ok) return null;
  try {
    const json = JSON.parse(await resp.clone().text()) as { usage?: unknown; id?: string; provider?: string };
    const u = parseUsageObject(json?.usage);
    if (!u) return null;
    return { ...u, requestId: json.id ?? null, upstream: json.provider ?? null };
  } catch {
    return null;
  }
}

function usageColumns(u: ParsedUsage, model: string | null): Record<string, unknown> {
  const cols: Record<string, unknown> = {
    prompt_tokens: u.promptTokens,
    completion_tokens: u.completionTokens,
    total_tokens: u.totalTokens,
    cached_prompt_tokens: u.cachedTokens,
    cache_write_tokens: u.cacheWriteTokens,
    reasoning_tokens: u.reasoningTokens,
  };
  if (u.costUsd != null) {
    cols.cost_usd_micro = Math.round(u.costUsd * 1_000_000);
    cols.cost_basis = "actual";
    cols.cost_source = "provider";
    cols.usage_state = "usage_confirmed";
  } else {
    const c = estimateCostUsdMicro(model, u.promptTokens, u.completionTokens);
    if (c != null) {
      cols.cost_usd_micro = c;
      cols.cost_basis = "estimated";
      cols.cost_source = "price_table";
    }
    cols.usage_state = "usage_estimated";
  }
  return cols;
}

async function recordTelemetry(
  args: TelemetryArgs & {
    usage?: ParsedUsage | null;
    requestId?: string | null;
    upstream?: string | null;
    extra?: Record<string, unknown>;
  },
): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTurnContext } = await import("@/server/turn-context.server");
    // Ambient turn attribution: explicit meta always wins, but a call made
    // anywhere inside a turn (preflight, triage, memory, design, recovery)
    // still lands on the right turn/project/user without threading arguments
    // through every call site.
    const ambient = currentTurnContext();
    const usageCols = args.usage ? usageColumns(args.usage, args.model) : {};
    const { explainAiCall, noteCallRow } = await import("@/server/engine/call-accounting");
    const why = explainAiCall({
      feature: args.feature,
      phase: args.phase ?? null,
      chosenBy: args.chosenBy ?? null,
      recoveryReason: (args.extra?.["recovery_reason"] as string | null | undefined) ?? null,
    });
    if (why.stage === "unclassified") console.warn(`[call-accounting] unexplained AI call: ${why.purpose}`);
    const { data } = await supabaseAdmin
      .from("ai_call_log")
      .insert({
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
        project_id: args.projectId ?? ambient.projectId ?? null,
        user_id: args.userId ?? ambient.userId ?? null,
        turn_id: args.turnId ?? ambient.turnId ?? null,
        attempt_id: ambient.attemptId ?? null,
        // "after_cancel" = background work that outlived its attempt — must
        // never be counted toward a live benchmark result.
        attempt_state: ambient.attemptId
          ? ambient.signal?.aborted
            ? "after_cancel"
            : ambient.ended
              ? "after_end"
              : "live"
          : null,
        key_owner: "platform",
        // Unknown until real usage arrives — never a fake 0.
        cost_basis: "unknown",
        cost_source: null,
        request_id: args.requestId ?? null,
        upstream_provider: args.upstream ?? null,
        ...(args.extra ?? {}),
        ...usageCols,
        stage: why.stage,
        purpose: why.purpose,
        call_kind: why.kind,
        invoke_reason: why.reason,
        parent_stage: why.parent,
      } as never)
      .select("id")
      .single();
    const rowId = (data as { id?: string } | null)?.id ?? null;
    noteCallRow(rowId);
    return rowId;
  } catch (err) {
    // Never break the AI call because logging failed.
    console.warn("[ai-provider] telemetry insert failed", err);
    return null;
  }
}

/**
 * OpenRouter generation record for one request id. Stats land a few seconds
 * after the stream closes, so poll briefly. Returns null (UNKNOWN) on any
 * failure — never a fake zero.
 */
export async function fetchGenerationUsage(requestId: string): Promise<ParsedUsage | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  for (const delay of [3_000, 6_000, 12_000]) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(requestId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      if (!res.ok) continue;
      const d = ((await res.json()) as { data?: Record<string, unknown> }).data;
      if (!d) continue;
      const p = num(d.native_tokens_prompt) ?? num(d.tokens_prompt);
      const c = num(d.native_tokens_completion) ?? num(d.tokens_completion);
      if (p == null && c == null) continue;
      return {
        promptTokens: p,
        completionTokens: c,
        totalTokens: p != null && c != null ? p + c : null,
        cachedTokens: num(d.native_tokens_cached),
        cacheWriteTokens: null,
        reasoningTokens: num(d.native_tokens_reasoning),
        costUsd: num(d.total_cost) ?? num(d.usage),
      };
    } catch {
      /* try again */
    }
  }
  return null;
}

/**
 * Wrap a streamed (SSE) response so its final usage chunk is parsed in-flight
 * and written onto the exact ai_call_log row for this call. This is what makes
 * primary build calls report real tokens regardless of how the caller consumes
 * the stream. The caller receives the same bytes, unchanged.
 */
function meterStream(
  resp: Response,
  rowId: Promise<string | null>,
  model: string | null,
  startedAt: number = Date.now(),
): Response {
  if (!resp.ok || !resp.body) return resp;
  const decoder = new TextDecoder();
  let buf = "";
  let last: ParsedUsage | null = null;
  // Header fallback: a stream that dies after one frame may never surface a
  // parsable id in the body, which left stalled calls with no usage lookup.
  let requestId: string | null =
    resp.headers.get("x-generation-id") ?? resp.headers.get("x-request-id") ?? null;
  // Captured at creation: stream callbacks may run outside the turn's
  // AsyncLocalStorage scope, but the context object is shared by reference.
  let turnCtx: import("@/server/turn-context.server").TurnContext | null = null;
  void import("@/server/turn-context.server")
    .then((m) => {
      turnCtx = m.currentTurnContext();
    })
    .catch(() => {});
  let upstream: string | null = null;
  let finishReason: string | null = null;
  // Stream health: "progress" = a frame that carries model output (text,
  // tool arguments or reasoning). Keep-alive comments do NOT count — they are
  // exactly what kept a dead DigitalOcean stream looking alive for minutes.
  let firstTokenAt: number | null = null;
  let lastTokenAt: number | null = null;
  let written = false;
  const scan = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const j = JSON.parse(payload) as {
        usage?: unknown;
        id?: string;
        provider?: string;
        choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: unknown }>;
      };
      if (j.provider) upstream = j.provider;
      if (typeof j.id === "string" && j.id) requestId = requestId ?? j.id;
      const errObj = (j as { error?: unknown }).error;
      if (errObj) streamError = JSON.stringify(errObj).slice(0, 500);
      const ch = j.choices?.[0];
      if (typeof ch?.finish_reason === "string") finishReason = ch.finish_reason;
      if (ch?.delta && streamDeltaHasOutput(ch.delta)) {
        const now = Date.now();
        if (firstTokenAt == null) firstTokenAt = now;
        lastTokenAt = now;
      }
      const u = j.usage ? parseUsageObject(j.usage) : null;
      if (u) {
        last = u;
        requestId = j.id ?? requestId;
      }
    } catch {
      /* partial / non-JSON line */
    }
  };
  let streamError: string | null = null;
  const finish = async (
    rawOutcome: "completed" | "stalled" | "cancelled" | "errored",
    stallMs: number | null,
  ) => {
    if (written) return;
    written = true;
    if (buf) scan(buf);
    const end = Date.now();
    // A stream that "completed" without a single output frame is a provider
    // failure, not a success — record it as such.
    const outcome =
      rawOutcome === "completed" && firstTokenAt == null ? (streamError ? "errored" : "empty") : rawOutcome;
    if ((outcome === "stalled" || outcome === "empty" || outcome === "errored") && upstream && turnCtx) {
      try {
        const { markUpstreamFailed } = await import("@/server/turn-context.server");
        markUpstreamFailed(upstream, turnCtx);
      } catch {
        /* ignore */
      }
    }
    let u = last as ParsedUsage | null;
    // Stalled / cancelled / empty streams never deliver the final usage
    // chunk, but the provider still bills them. Read the real numbers from
    // OpenRouter's generation record instead of leaving tokens/cost unknown.
    if (!u && requestId) u = await fetchGenerationUsage(requestId);
    try {
      const id = await rowId;
      if (!id) return;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("ai_call_log")
        .update({
          // Honest accounting: no usage from the provider is recorded as
          // UNKNOWN — never as zero tokens or a free call.
          ...(u ? usageColumns(u, model) : { usage_state: "usage_unknown" }),
          ...(u && !last && u.costUsd != null ? { cost_source: "provider_generation" } : {}),
          ...(!u ? { cost_source: "unknown" } : {}),
          ...(requestId ? { request_id: requestId } : {}),
          ...(upstream ? { upstream_provider: upstream } : {}),
          ...(streamError ? { error_message: streamError } : {}),
          first_token_ms: firstTokenAt != null ? firstTokenAt - startedAt : null,
          last_token_ms: lastTokenAt != null ? lastTokenAt - startedAt : null,
          stream_total_ms: end - startedAt,
          finish_reason: finishReason,
          stream_outcome: outcome,
          stall_ms: stallMs,
        } as never)
        .eq("id", id);
    } catch (err) {
      console.warn("[ai-provider] stream usage write failed", err);
    }
  };
  const reader = resp.body.getReader();
  const out = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          ctrl.close();
          void finish("completed", null);
          return;
        }
        ctrl.enqueue(value);
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) scan(l);
      } catch (err) {
        void finish("errored", null);
        ctrl.error(err);
      }
    },
    async cancel(reason) {
      // relayAndCollect cancels with "stall:<ms>" when the provider stops
      // making progress; record that so a dead-provider wait is visible.
      const m = /^stall:(\d+)/.exec(String(reason ?? ""));
      void finish(m ? "stalled" : "cancelled", m ? Number(m[1]) : null);
      try { await reader.cancel(reason); } catch { /* ignore */ }
    },
  });
  return new Response(out, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

/** True when an SSE delta carries actual model output (text, tool args, reasoning). */
export function streamDeltaHasOutput(delta: Record<string, unknown>): boolean {
  const txt = (v: unknown) => typeof v === "string" && v.length > 0;
  if (txt(delta.content) || txt(delta.reasoning) || txt(delta.reasoning_content)) return true;
  if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) return true;
  const tcs = delta.tool_calls;
  if (Array.isArray(tcs)) {
    for (const tc of tcs as Array<{ function?: { name?: unknown; arguments?: unknown } }>) {
      if (txt(tc?.function?.arguments) || txt(tc?.function?.name)) return true;
    }
  }
  return false;
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
  /** Provider-reported USD cost for this call, when the gateway returns one
   *  (OpenRouter does). When present it is recorded as ACTUAL cost; otherwise
   *  we fall back to the internal price table and mark it ESTIMATED. */
  actualCostUsd?: number | null;
  turnId?: string | null;
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
    // Scope to the turn so we never patch an older, unrelated NULL row.
    if (args.turnId) q = q.eq("turn_id", args.turnId);
    const { data: rows } = await q;
    const id = rows?.[0]?.id;
    if (!id) return;
    const patch: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      cost_usd_micro?: number | null;
      cost_basis?: string;
      cost_source?: string | null;
      turn_id?: string | null;
      cached_prompt_tokens?: number | null;
      static_prefix_chars?: number | null;
      static_prefix_hash?: string | null;
      files_sent?: number | null;
    } = {
      prompt_tokens: args.promptTokens,
      completion_tokens: args.completionTokens,
      total_tokens: args.totalTokens,
    };
    // Prefer the provider's own number. Only fall back to the internal price
    // table when the gateway gave us nothing, and always say which it was.
    if (args.actualCostUsd != null && Number.isFinite(args.actualCostUsd)) {
      patch.cost_usd_micro = Math.round(args.actualCostUsd * 1_000_000);
      patch.cost_basis = "actual";
      patch.cost_source = "provider";
    } else {
      const cost = estimateCostUsdMicro(
        args.model,
        args.promptTokens,
        args.completionTokens,
      );
      if (cost != null) {
        patch.cost_usd_micro = cost;
        patch.cost_basis = "estimated";
        patch.cost_source = "price_table";
      }
    }
    if (args.turnId) patch.turn_id = args.turnId;
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
  /** P1-5: project this AI call is attributed to (null = workspace-wide). */
  projectId?: string | null;
  /** P1-5: user who triggered this AI call. */
  userId?: string | null;
  /** Economics: the user turn this call belongs to. */
  turnId?: string | null;
  /** Stream-health telemetry: 0 = first attempt, 1 = first provider fallback. */
  fallbackNumber?: number | null;
  /** Upstream abandoned before this attempt (e.g. stalled DigitalOcean). */
  fallbackFromUpstream?: string | null;
  /** Why this call exists when it is a recovery (provider_stall, stream_continuation…). */
  recoveryReason?: string | null;
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
  /**
   * When true, this call may be routed to an ultra-cheap budget model via
   * OpenRouter if the user has economy mode enabled or if admin shadow testing
   * is active. Callers should opt in for non-critical, low-risk features.
   */
  budgetAware?: boolean;
  /** Optional timeout-tier override. Inferred from `body.stream` when omitted. */
  timeoutTier?: AiCallTimeoutTier;
  /** Force a specific provider regardless of the per-feature DB setting. */
  providerOverride?: Provider;
  /**
   * Keep the caller-supplied model for protocol-critical calls such as forced
   * tool output. Operator feature overrides are useful for normal generation,
   * but substituting a model that ignores `tool_choice` breaks the contract.
   */
  lockCallerModel?: boolean;
  /**
   * Skip the bounded fallback retry. For cosmetic helpers (friendly error
   * wording, self-check) a second paid round-trip buys nothing: the caller
   * already has a deterministic fallback.
   */
  noFallback?: boolean;
  /**
   * The call must emit CODE (byte-level continuation). Skips the utility-tier
   * model and its 1,024-token cap, and the caller disables reasoning, so the
   * whole budget goes to output instead of hidden thinking.
   */
  codeOutput?: boolean;
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
  // Economy mode / shadow budget routing: cheapen eligible features for users
  // who opted in or for the admin-configured shadow percentage.
  let budgetProviderOverride = opts.providerOverride;
  let budgetModelOverride: string | undefined;
  if (
    opts.budgetAware &&
    opts.meta?.userId &&
    opts.feature !== "image" &&
    opts.feature !== "recovery"
  ) {
    try {
      const [economy, cfg, shadow] = await Promise.all([
        getUserEconomyMode(opts.meta.userId),
        getBudgetConfigForFeature(opts.feature),
        shouldShadowBudget(opts.feature),
      ]);
      if (cfg.enabled && cfg.allowedModels.length > 0 && (economy || shadow)) {
        const picked = await pickBudgetModelForFeature(
          opts.feature,
          (opts.body.messages as unknown[] | undefined) ?? [],
          cfg.allowedModels,
        );
        if (picked) {
          budgetModelOverride = picked;
          budgetProviderOverride = "openrouter";
        }
      }
    } catch (err) {
      // Budget routing is best-effort; never block a request because the
      // economy check failed.
      console.warn("[budget] routing failed, using default model:", err);
    }
  }

  // Provider is always OpenRouter — `budgetProviderOverride` can only ever be
  // "openrouter" too; kept for telemetry shape compatibility.
  const provider: Provider = budgetProviderOverride ?? (await resolveProvider(opts.feature));
  const { model: dbModel, fallback } = await resolveModelOverride(opts.feature);

  // DB model normally wins over caller-supplied model (operator overrides have
  // priority). Protocol-critical callers can lock a known tool-capable model;
  // budget routing remains highest priority when explicitly enabled.
  const callerModel = (opts.body.model as string | undefined) ?? undefined;
  const requestedModel =
    budgetModelOverride || (opts.lockCallerModel ? callerModel : dbModel || callerModel) || null;

  // OPENROUTER-ONLY MODEL POLICY. Every requested slug is normalised to the
  // centrally configured DeepSeek model (src/lib/ai-model-config.ts) so no
  // legacy hardcoded Gemini/GPT/Claude id can reach the wire. `openrouter/auto`
  // is never used — the model is always explicit.
  const needsVision = requestHasImageParts(opts.body);
  // Utility tier: short classification / summarisation features run on the
  // cheaper utility model unless the caller asked for a specific DeepSeek slug
  // or the request carries images.
  const utility = isUtilityFeature(opts.feature) && !needsVision && !opts.codeOutput;
  let primaryModel: string = coerceToConfiguredModel(requestedModel, {
    vision: needsVision,
    utility,
  });
  const coercedFallback = coerceToConfiguredModel(fallback ?? defaultFallbackModel(), {
    vision: needsVision,
  });
  const fallbackModel = coercedFallback === primaryModel ? null : coercedFallback;


  // Kill-switch: if the primary model is currently cooling off because of a
  // high `no_edit_emitted` rate, swap it for the configured fallback BEFORE
  // we make the call. Prevents the "every turn keeps hitting the same broken
  // model" loop until the cool-off window expires.
  const { isModelKilled } = await import("@/server/model-kill-switch.server");
  if (isModelKilled(primaryModel) && fallbackModel && !isModelKilled(fallbackModel)) {
    console.warn(
      `[kill-switch] swapping primary ${primaryModel} → ${fallbackModel} (cooling off)`,
    );
    primaryModel = fallbackModel;
  }

  // Health guard (audit 3b): a model whose last ~50 logged calls are almost
  // all errors is a configuration problem, not an outage. Skip it up front
  // instead of paying a guaranteed-failed round-trip on every turn.
  const { isModelUnhealthySync } = await import("@/server/model-health.server");
  if (
    isModelUnhealthySync(primaryModel) &&
    fallbackModel &&
    !isModelUnhealthySync(fallbackModel)
  ) {
    console.warn(
      `[model-health] swapping primary ${primaryModel} → ${fallbackModel} (rolling error rate too high)`,
    );
    primaryModel = fallbackModel;
  }

  const body: Record<string, unknown> = { ...opts.body, model: primaryModel };
  // Cost guard: a classification call never needs a long answer. Cap it unless
  // the caller already asked for less.
  if (utility) {
    const asked = typeof body.max_tokens === "number" ? (body.max_tokens as number) : null;
    body.max_tokens =
      asked && asked > 0 ? Math.min(asked, UTILITY_MAX_OUTPUT_TOKENS) : UTILITY_MAX_OUTPUT_TOKENS;
  }
  // Primary code generation: DeepInfra first, reliable fallbacks, never
  // DigitalOcean/NextBit. Scoped to "generate" tool calls only.
  // One authoritative per-turn exclusion set: every upstream that already
  // failed in this turn is avoided by EVERY later call, whatever path makes it.
  let turnFailed: string[] = [];
  try {
    const { failedUpstreamsForTurn } = await import("@/server/turn-context.server");
    turnFailed = failedUpstreamsForTurn();
  } catch {
    /* no ambient turn */
  }
  const hasTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;
  const isCodeWriting = opts.codeOutput === true || (opts.feature === "generate" && hasTools);
  // Sole provider authority: any caller-supplied provider block is replaced.
  delete body.provider;
  let inferenceEval: { models: string[] } | null = null;
  try {
    const { currentTurnContext } = await import("@/server/turn-context.server");
    inferenceEval = currentTurnContext().inferenceEval ?? null;
  } catch { /* no turn */ }
  const routing = inferenceEval && isCodeWriting
    // Evaluation: OpenRouter owns provider failover for each model; Kimble
    // only names the model chain. NextBit stays excluded (it corrupts tool
    // arguments — a known correctness defect, not an availability one).
    ? { allow_fallbacks: true, require_parameters: true, ignore: ["nextbit"] }
    : resolveProviderRouting({ codeWriting: isCodeWriting, avoid: turnFailed, hasTools });
  if (routing) body.provider = routing;
  if (inferenceEval && isCodeWriting) {
    body.model = inferenceEval.models[0];
    if (inferenceEval.models.length > 1) body.models = inferenceEval.models;
    body.__inferenceEval = true;
  }
  if (isCodeWriting) console.log(`[provider-policy] avoid=${turnFailed.join(",") || "-"} routing=${JSON.stringify(routing)}`);
  const streamExtra = {
    fallback_number: opts.meta?.fallbackNumber ?? (body.stream === true ? 0 : null),
    fallback_from_upstream: opts.meta?.fallbackFromUpstream ?? null,
    recovery_reason: opts.meta?.recoveryReason ?? null,
  };



  const t0 = Date.now();
  let primary = await dispatch(provider, body, opts.signal, opts.timeoutTier);
  // Configured ≠ available. When every upstream this call was allowed has no
  // usable endpoint ("no provider available" 404, or a provider-level
  // 408/502/503/524 before any output), they are marked failed for THIS turn
  // only and the same policy is asked again — which now opens the next
  // approved upstream (DeepInfra last). One re-dispatch; never a loop.
  if (isCodeWriting && !inferenceEval && !primary.ok && isProviderUnavailableStatus(primary.status)) {
    const tried = ((body.provider as { only?: string[] } | undefined)?.only ?? []).slice();
    if (tried.length) {
      try {
        const { markUpstreamFailed, failedUpstreamsForTurn } = await import("@/server/turn-context.server");
        for (const u of tried) markUpstreamFailed(u);
        const next = resolveProviderRouting({ codeWriting: true, avoid: failedUpstreamsForTurn(), hasTools }) as { only?: string[] } | undefined;
        if (next?.only?.length) {
          console.warn(`[provider-policy] unavailable=${tried.join(",")} status=${primary.status} → next=${next.only.join(",")}`);
          body.provider = next;
          primary = await dispatch(provider, body, opts.signal, opts.timeoutTier);
        }
      } catch {
        /* no ambient turn — keep the original response */
      }
    }
  }
  const latency = Date.now() - t0;
  const effectiveProvider = provider;
  if (primary.status === 402) {
    (globalThis as Record<string, unknown>)["__petalLastProviderPaymentFailureAt"] = Date.now();
  }

  // NOTE: there is no cross-provider failover any more. OpenRouter is the only
  // gateway, so a 401/402/403 is an account problem that a second provider
  // cannot paper over. At most ONE bounded retry (fallback model) happens below,
  // which guarantees a single operation never fans out to multiple providers.

  // Decide whether to retry on fallback model (same provider).
  // Retry on 5xx, 429 (rate-limit), 402 (credits), AND 400/404 — the latter
  // catches "invalid model slug" / "model not found" so a typo in the admin
  // override doesn't burn 100% of that feature's calls.
  const shouldRetry =
    !primary.ok &&
    !opts.noFallback &&
    !!fallbackModel &&

    (primary.status === 429 ||
      primary.status === 402 ||
      primary.status === 400 ||
      primary.status === 404 ||
      primary.status >= 500);

  if (!shouldRetry) {
    // Non-streamed calls carry their usage in the body (read from a clone).
    // Streamed calls are metered in-flight by `meterStream` onto this row.
    // Non-streamed: buffer the body ONCE and hand the caller a fresh,
    // unread Response. Reading a tee'd clone raced the caller's own read
    // ("Body has already been read" in the design step).
    if (body.stream !== true) primary = await bufferedResponse(primary);
    const usage = await usageFromResponse(primary, body);
    const rowId = recordTelemetry({
      feature: opts.feature,
      provider: effectiveProvider,
      model: primaryModel,
      status: primary.status,
      latencyMs: latency,
      fallbackUsed: false,
      errorMessage: primary.ok ? null : `HTTP ${primary.status}`,
      phase: opts.meta?.phase ?? null,
      promptChars: opts.meta?.promptChars ?? null,
      hadAttachments: opts.meta?.hadAttachments ?? false,
      chosenBy: opts.meta?.chosenBy ?? null,
      projectId: opts.meta?.projectId ?? null,
      userId: opts.meta?.userId ?? null,
      turnId: opts.meta?.turnId ?? null,
      usage,
      requestId: usage?.requestId ?? null,
      upstream: usage?.upstream ?? null,
      extra: streamExtra,
    });
    return body.stream === true ? meterStream(primary, rowId, primaryModel, t0) : primary;
  }


  // Drain the failed response so we can safely discard it.
  try {
    await primary.text();
  } catch {
    /* ignore */
  }

  void recordTelemetry({
    feature: opts.feature,
    provider: effectiveProvider,
    model: primaryModel,
    status: primary.status,
    latencyMs: latency,
    fallbackUsed: false,
    errorMessage: `Primary failed HTTP ${primary.status}, retrying with fallback`,
    phase: opts.meta?.phase ?? null,
    promptChars: opts.meta?.promptChars ?? null,
    hadAttachments: opts.meta?.hadAttachments ?? false,
    chosenBy: opts.meta?.chosenBy ?? null,
    projectId: opts.meta?.projectId ?? null,
    userId: opts.meta?.userId ?? null,
    turnId: opts.meta?.turnId ?? null,
  });

  const fallbackBody: Record<string, unknown> = { ...body, model: fallbackModel };
  const t1 = Date.now();
  let retried = await dispatch(effectiveProvider, fallbackBody, opts.signal, opts.timeoutTier);
  if (fallbackBody.stream !== true) retried = await bufferedResponse(retried);
  const retryLatency = Date.now() - t1;
  const retryUsage = await usageFromResponse(retried, fallbackBody);

  const retryRow = recordTelemetry({
    feature: opts.feature,
    provider: effectiveProvider,
    model: fallbackModel,
    status: retried.status,
    latencyMs: retryLatency,
    fallbackUsed: true,
    errorMessage: retried.ok ? null : `HTTP ${retried.status}`,
    phase: opts.meta?.phase ?? null,
    promptChars: opts.meta?.promptChars ?? null,
    hadAttachments: opts.meta?.hadAttachments ?? false,
    chosenBy: opts.meta?.chosenBy ?? null,
    projectId: opts.meta?.projectId ?? null,
    userId: opts.meta?.userId ?? null,
    turnId: opts.meta?.turnId ?? null,
    usage: retryUsage,
    requestId: retryUsage?.requestId ?? null,
    upstream: retryUsage?.upstream ?? null,
    extra: { ...streamExtra, fallback_number: (streamExtra.fallback_number ?? 0) + 1 },
  });

  return fallbackBody.stream === true ? meterStream(retried, retryRow, fallbackModel, t1) : retried;
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
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Last time an upstream model call came back HTTP 402 ("not enough credits").
 *
 * That is PETAL's gateway account running dry, not the end user's wallet. When
 * it happens the generation pipeline usually surfaces downstream as "the model
 * returned no files", which we then humanized into "that might be too complex
 * for me" — blaming the user's prompt for our own billing outage. Recording
 * the signal here lets the failure classifier attribute it correctly.
 */
// Stored on globalThis, not a module-scope binding: this file gets split into
// multiple server chunks, and a plain `let` is not guaranteed to be shared (or
// even reachable) from every chunk that touches it.
const PAYMENT_FAILURE_KEY = "__petalLastProviderPaymentFailureAt";

export function markProviderPaymentFailure(): void {
  (globalThis as Record<string, unknown>)[PAYMENT_FAILURE_KEY] = Date.now();
}

/** True when a provider 402 happened recently enough to explain this failure. */
export function hadRecentProviderPaymentFailure(withinMs = 5 * 60_000): boolean {
  const at = (globalThis as Record<string, unknown>)[PAYMENT_FAILURE_KEY];
  return typeof at === "number" && at > 0 && Date.now() - at < withinMs;
}
/**
 * Hard wall-clock ceiling for streamed turns. Deliberately very long — users
 * would rather wait for a large build to finish than see it cut off mid-file.
 * The per-turn idle watchdog in `relayAndCollect` is what actually catches
 * a wedged provider (no bytes for N seconds); this ceiling only fires in the
 * pathological case where the upstream keeps trickling tokens forever.
 */
const DEFAULT_STREAM_TIMEOUT_MS = 900_000;
/** Initial scaffolds match the streaming ceiling. */
const FIRST_BUILD_STREAM_TIMEOUT_MS = 900_000;

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
  _provider: Provider,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  tierOverride?: AiCallTimeoutTier,
): Promise<Response> {
  const url = OPENROUTER_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Kimble routes all AI traffic through OpenRouter.",
    );
  }
  // Final safety net: coerce whatever slug arrives here to the configured model.
  let outBody: Record<string, unknown> = body;
  const evalRun = outBody.__inferenceEval === true;
  if ("__inferenceEval" in outBody) { outBody = { ...outBody }; delete outBody.__inferenceEval; }
  const wireModel = evalRun ? (outBody.model as string) : coerceToConfiguredModel(
    remapModelForOpenRouter(outBody.model as string | undefined) ?? defaultTextModel(),
    { vision: requestHasImageParts(outBody) },
  );
  if (wireModel !== outBody.model) {
    outBody = { ...outBody, model: wireModel };
  }
  // Ask OpenRouter for token usage on streamed calls too, so `ai_call_log`
  // records prompt/completion/total tokens for every request.
  if (outBody.stream === true && !outBody.stream_options) {
    outBody = { ...outBody, stream_options: { include_usage: true } };
  }
  // OpenRouter: always return usage (incl. cached tokens + real cost).
  if (!outBody.usage) outBody = { ...outBody, usage: { include: true } };
  // Provider routing is decided solely by engine/provider-policy (set in
  // aiChatCompletions). dispatch never adds or changes a provider block.
  // Sticky routing per project so repeated calls land on the same upstream
  // and can reuse its prompt cache. Stable per project — never per request.
  if (!outBody.session_id) {
    try {
      const { currentTurnContext } = await import("@/server/turn-context.server");
      const pid = currentTurnContext().projectId;
      if (pid) outBody = { ...outBody, session_id: `kimble-${pid}` };
    } catch {
      /* no ambient turn */
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  {
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER || "https://buildwithpetal.com";
    headers["X-Title"] = "Kimble";
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

/** Provider-level unavailability (not bad model output). */
export function isProviderUnavailableStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 502 || status === 503 || status === 524;
}
