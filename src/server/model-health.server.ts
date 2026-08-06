/**
 * Model health guard (audit item 3b).
 *
 * Two protections that the static dead-model remap could not give us:
 *
 *  1. **Unknown-id assertion** — any model id configured in
 *     `ai_provider_settings` (or passed by a caller) that is not in our
 *     known catalog is flagged loudly. Historically a typo'd slug just
 *     burned 100% of a feature's calls and silently fell back.
 *
 *  2. **Rolling error-rate auto-skip** — reads the last N `ai_call_log`
 *     rows per model. If a model is at/over the error threshold across a
 *     meaningful sample, it is treated as unhealthy: the router skips it
 *     in favour of the configured fallback, and the admin console shows a
 *     red row.
 *
 * The snapshot is cached in-process for a few minutes; this runs on the
 * hot path of every generate turn, so it must never add a query per call.
 */
import { BUDGET_MODELS, KNOWN_MODEL_IDS } from "@/server/ai-provider.server";

/** How many recent calls per model we consider. */
const WINDOW_CALLS = 50;
/** Minimum sample before a model can be declared unhealthy. */
const MIN_SAMPLE = 8;
/** Error ratio at or above which the model is auto-skipped. */
const TRIP_RATE = 0.9;
/** Snapshot cache TTL. */
const CACHE_MS = 5 * 60 * 1000;

export type ModelHealthRow = {
  model: string;
  calls: number;
  errors: number;
  errorRate: number;
  unhealthy: boolean;
  known: boolean;
  lastErrorMessage: string | null;
};

let cache: { at: number; rows: ModelHealthRow[] } | null = null;
let inflight: Promise<ModelHealthRow[]> | null = null;

/** True when the id is not in the known catalog (typo / stale constant). */
export function isUnknownModelId(model: string | null | undefined): boolean {
  if (!model) return false;
  if (KNOWN_MODEL_IDS.has(model)) return false;
  return !BUDGET_MODELS.some((m) => m.id === model);
}

async function computeHealth(): Promise<ModelHealthRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Pull a bounded recent slice and bucket in memory — cheaper and simpler
  // than a per-model windowed SQL query, and the volume here is small.
  const { data, error } = await supabaseAdmin
    .from("ai_call_log")
    .select("model, status, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(WINDOW_CALLS * 24);
  if (error || !data) return [];

  const buckets = new Map<
    string,
    { calls: number; errors: number; lastErrorMessage: string | null }
  >();
  for (const row of data) {
    const model = (row as { model: string | null }).model;
    if (!model) continue;
    const b = buckets.get(model) ?? { calls: 0, errors: 0, lastErrorMessage: null };
    if (b.calls >= WINDOW_CALLS) continue; // rows are newest-first
    b.calls += 1;
    const status = (row as { status: number | null }).status ?? 0;
    if (status === 0 || status >= 400) {
      b.errors += 1;
      if (!b.lastErrorMessage) {
        b.lastErrorMessage = (row as { error_message: string | null }).error_message;
      }
    }
    buckets.set(model, b);
  }

  const rows: ModelHealthRow[] = [...buckets.entries()].map(([model, b]) => {
    const errorRate = b.calls > 0 ? b.errors / b.calls : 0;
    return {
      model,
      calls: b.calls,
      errors: b.errors,
      errorRate,
      unhealthy: b.calls >= MIN_SAMPLE && errorRate >= TRIP_RATE,
      known: !isUnknownModelId(model),
      lastErrorMessage: b.lastErrorMessage,
    };
  });

  rows.sort((a, b) => b.errorRate - a.errorRate || b.calls - a.calls);

  for (const r of rows) {
    if (r.unhealthy) {
      console.error(
        `[model-health] ${r.model} is failing ${r.errors}/${r.calls} recent calls (${Math.round(
          r.errorRate * 100,
        )}%) — auto-skipping in favour of the fallback model.`,
      );
    } else if (!r.known) {
      console.warn(
        `[model-health] "${r.model}" is not in the known model catalog — likely a typo or a stale admin override.`,
      );
    }
  }

  return rows;
}

/** Cached health snapshot. Never throws — health checks must not break calls. */
export async function getModelHealth(force = false): Promise<ModelHealthRow[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  if (inflight) return inflight;
  inflight = computeHealth()
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .catch((err) => {
      console.warn("[model-health] snapshot failed:", err);
      return cache?.rows ?? [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Hot-path check. Uses only the cached snapshot so it costs nothing; the
 * refresh is kicked off in the background when the cache goes stale.
 */
export function isModelUnhealthySync(model: string | null | undefined): boolean {
  if (!model) return false;
  if (!cache || Date.now() - cache.at >= CACHE_MS) {
    void getModelHealth();
    if (!cache) return false;
  }
  return cache.rows.some((r) => r.model === model && r.unhealthy);
}

/** Admin surface: configured ids that are unknown to the catalog. */
export async function auditConfiguredModels(): Promise<
  Array<{ feature: string; model: string | null; fallback: string | null; issues: string[] }>
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("feature, model, fallback_model");
  const health = await getModelHealth();
  const unhealthy = new Set(health.filter((h) => h.unhealthy).map((h) => h.model));

  return (data ?? []).map((row) => {
    const r = row as { feature: string; model: string | null; fallback_model: string | null };
    const issues: string[] = [];
    for (const [label, id] of [
      ["model", r.model],
      ["fallback", r.fallback_model],
    ] as const) {
      if (!id) continue;
      if (isUnknownModelId(id)) issues.push(`${label} "${id}" is not in the known catalog`);
      if (unhealthy.has(id)) issues.push(`${label} "${id}" is failing almost every call`);
    }
    return { feature: r.feature, model: r.model, fallback: r.fallback_model, issues };
  });
}
