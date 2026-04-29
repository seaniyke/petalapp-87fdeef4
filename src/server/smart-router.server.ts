/**
 * Tier 4 — Telemetry-driven smart router.
 *
 * Reads recent rows from `ai_call_log` and picks the best model per
 * (feature, phase) based on observed success rate / latency / cost.
 * This is the "logistic-regression-grade" router that CodeRouter / Bolt
 * use internally — without the ML overhead, because a small problem
 * (≤6 candidates per slot) doesn't need it.
 *
 * Scoring (Thompson-sampling-lite):
 *
 *   score(model) = success_rate / (cost_score + ε) - latency_penalty
 *
 *   - success_rate: (calls - errors) / calls  (smoothed: +1 success, +2 trials)
 *   - cost_score:   median cost_usd_micro over the window, normalized
 *   - latency_pen:  small bump if p50 latency > 5s (only used as a tie-breaker)
 *
 * Models with < `min_samples` calls in the window get a "needs more
 * data" status and are kept in the rotation via epsilon-greedy
 * exploration (default 10%).
 *
 * Caching: full snapshot recomputed every 5 minutes (in-memory, per
 * Worker isolate). Reads are non-blocking; first call after expiry
 * triggers a background refresh and returns the previous snapshot.
 *
 * Kill switch: `ai_router_config.enabled = false` short-circuits to
 * the caller's default model.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AiFeature } from "@/server/ai-provider.server";
import type { Phase } from "@/server/phase-classifier.server";

export interface RouterConfig {
  enabled: boolean;
  explorationPct: number; // 0–100
  minSamples: number;
  windowHours: number;
}

export interface ModelStat {
  model: string;
  calls: number;
  errors: number;
  successRate: number; // smoothed HTTP-level success
  medianCostMicro: number;
  p50LatencyMs: number;
  score: number;
  enoughData: boolean;
  // Phase B — outcome quality (joined from ai_call_outcomes / ai_model_quality).
  outcomeSamples: number;
  verifierPassRate: number | null;   // 0..1
  buildSuccessRate: number | null;   // 0..1
  followupFixRate: number | null;    // 0..1 (lower = better)
  avgAutofixes: number | null;
}

export interface RouterSnapshot {
  builtAt: number;
  config: RouterConfig;
  // key = `${feature}|${phase}`
  byFeaturePhase: Map<string, ModelStat[]>;
  // key = feature only (fallback when phase has no data)
  byFeature: Map<string, ModelStat[]>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: RouterSnapshot | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<RouterSnapshot> | null = null;

const DEFAULT_CONFIG: RouterConfig = {
  enabled: true,
  explorationPct: 10,
  minSamples: 5,
  windowHours: 168,
};

async function loadConfig(): Promise<RouterConfig> {
  try {
    const { data } = await supabaseAdmin
      .from("ai_router_config")
      .select("enabled, exploration_pct, min_samples, window_hours")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return DEFAULT_CONFIG;
    return {
      enabled: Boolean(data.enabled),
      explorationPct: data.exploration_pct ?? DEFAULT_CONFIG.explorationPct,
      minSamples: data.min_samples ?? DEFAULT_CONFIG.minSamples,
      windowHours: data.window_hours ?? DEFAULT_CONFIG.windowHours,
    };
  } catch (e) {
    console.warn("[smart-router] config load failed, using defaults:", e);
    return DEFAULT_CONFIG;
  }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface RawRow {
  feature: string;
  phase: string | null;
  model: string | null;
  status: number;
  cost_usd_micro: number | null;
  latency_ms: number | null;
}

interface OutcomeAgg {
  samples: number;
  verifierPassRate: number;
  buildSuccessRate: number;
  followupFixRate: number;
  avgAutofixes: number;
}

function buildSnapshot(
  rows: RawRow[],
  config: RouterConfig,
  outcomesByModel: Map<string, OutcomeAgg>,
): RouterSnapshot {
  // Group raw rows by (feature, phase, model) and (feature, model).
  type Bucket = {
    calls: number;
    errors: number;
    costs: number[];
    latencies: number[];
  };
  const fp = new Map<string, Map<string, Bucket>>();
  const f = new Map<string, Map<string, Bucket>>();

  const ensure = (
    map: Map<string, Map<string, Bucket>>,
    outer: string,
    model: string,
  ): Bucket => {
    let inner = map.get(outer);
    if (!inner) {
      inner = new Map();
      map.set(outer, inner);
    }
    let b = inner.get(model);
    if (!b) {
      b = { calls: 0, errors: 0, costs: [], latencies: [] };
      inner.set(model, b);
    }
    return b;
  };

  for (const r of rows) {
    const model = r.model;
    if (!model) continue;
    const isError = typeof r.status === "number" && r.status >= 400;
    const cost = r.cost_usd_micro ?? 0;
    const latency = r.latency_ms ?? 0;

    const phaseKey = `${r.feature}|${r.phase ?? "unknown"}`;
    const fpBucket = ensure(fp, phaseKey, model);
    fpBucket.calls += 1;
    if (isError) fpBucket.errors += 1;
    fpBucket.costs.push(cost);
    fpBucket.latencies.push(latency);

    const fBucket = ensure(f, r.feature, model);
    fBucket.calls += 1;
    if (isError) fBucket.errors += 1;
    fBucket.costs.push(cost);
    fBucket.latencies.push(latency);
  }

  const finalize = (
    raw: Map<string, Map<string, Bucket>>,
  ): Map<string, ModelStat[]> => {
    const out = new Map<string, ModelStat[]>();
    for (const [outer, inner] of raw) {
      const stats: ModelStat[] = [];
      for (const [model, b] of inner) {
        // Smoothing: pretend +1 success, +2 trials so brand-new models aren't 0% or 100%.
        const successes = b.calls - b.errors;
        const successRate = (successes + 1) / (b.calls + 2);
        const medianCostMicro = median(b.costs);
        const p50LatencyMs = median(b.latencies);
        const enoughData = b.calls >= config.minSamples;

        // Pull outcome quality for this model (feature-agnostic — outcomes
        // are aggregated per model in `ai_model_quality`).
        const oc = outcomesByModel.get(model) ?? null;
        const verifierPassRate = oc ? oc.verifierPassRate : null;
        const buildSuccessRate = oc ? oc.buildSuccessRate : null;
        const followupFixRate = oc ? oc.followupFixRate : null;
        const avgAutofixes = oc ? oc.avgAutofixes : null;
        const outcomeSamples = oc ? oc.samples : 0;

        // Score blends:
        //   - HTTP success-per-cost (the original signal — keeps free fast
        //     models alive when outcomes data is empty)
        //   - quality multiplier from outcomes (if we have ≥3 samples):
        //       0.6 * build_success + 0.3 * verifier_pass + 0.1 * (1 - followup_fix)
        //     This rewards models whose generations actually compile and
        //     don't immediately get a "fix this" follow-up turn.
        const costScore = medianCostMicro / 1000 + 1; // micro → milli, +1
        const latencyPenalty = p50LatencyMs > 5000 ? 0.05 : 0;
        const httpScore = successRate / costScore - latencyPenalty;

        let qualityMult = 1;
        if (outcomeSamples >= 3) {
          qualityMult =
            0.6 * (buildSuccessRate ?? 0.5) +
            0.3 * (verifierPassRate ?? 0.5) +
            0.1 * (1 - (followupFixRate ?? 0.5));
          // Keep multiplier in [0.25, 1.5] so a single bad day can't
          // permanently kill a model.
          qualityMult = Math.max(0.25, Math.min(1.5, qualityMult * 1.5));
        }
        const score = httpScore * qualityMult;

        stats.push({
          model,
          calls: b.calls,
          errors: b.errors,
          successRate,
          medianCostMicro,
          p50LatencyMs,
          score,
          enoughData,
          outcomeSamples,
          verifierPassRate,
          buildSuccessRate,
          followupFixRate,
          avgAutofixes,
        });
      }
      stats.sort((a, b) => b.score - a.score);
      out.set(outer, stats);
    }
    return out;
  };

  return {
    builtAt: Date.now(),
    config,
    byFeaturePhase: finalize(fp),
    byFeature: finalize(f),
  };
}

async function loadOutcomes(): Promise<Map<string, OutcomeAgg>> {
  // `ai_model_quality` is a 7-day rolling view aggregated per (feature,
  // provider, model). We collapse across feature/provider here so a model's
  // quality follows it everywhere it's used.
  const out = new Map<string, OutcomeAgg>();
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_model_quality")
      .select("model, samples, verifier_pass_rate, build_success_rate, followup_fix_rate, avg_autofixes");
    if (error) {
      console.warn("[smart-router] outcomes read failed:", error.message);
      return out;
    }
    // Weighted merge by sample count when the same model appears under
    // multiple (feature, provider) rows.
    for (const r of (data ?? []) as Array<{
      model: string | null;
      samples: number | null;
      verifier_pass_rate: number | null;
      build_success_rate: number | null;
      followup_fix_rate: number | null;
      avg_autofixes: number | null;
    }>) {
      if (!r.model || !r.samples) continue;
      const prev = out.get(r.model);
      if (!prev) {
        out.set(r.model, {
          samples: r.samples,
          verifierPassRate: Number(r.verifier_pass_rate ?? 0),
          buildSuccessRate: Number(r.build_success_rate ?? 0),
          followupFixRate: Number(r.followup_fix_rate ?? 0),
          avgAutofixes: Number(r.avg_autofixes ?? 0),
        });
      } else {
        const total = prev.samples + r.samples;
        out.set(r.model, {
          samples: total,
          verifierPassRate:
            (prev.verifierPassRate * prev.samples + Number(r.verifier_pass_rate ?? 0) * r.samples) / total,
          buildSuccessRate:
            (prev.buildSuccessRate * prev.samples + Number(r.build_success_rate ?? 0) * r.samples) / total,
          followupFixRate:
            (prev.followupFixRate * prev.samples + Number(r.followup_fix_rate ?? 0) * r.samples) / total,
          avgAutofixes:
            (prev.avgAutofixes * prev.samples + Number(r.avg_autofixes ?? 0) * r.samples) / total,
        });
      }
    }
  } catch (e) {
    console.warn("[smart-router] outcomes load threw:", e);
  }
  return out;
}

async function rebuildSnapshot(): Promise<RouterSnapshot> {
  const config = await loadConfig();
  const since = new Date(Date.now() - config.windowHours * 60 * 60 * 1000).toISOString();

  const [logRes, outcomes] = await Promise.all([
    supabaseAdmin
      .from("ai_call_log")
      .select("feature, phase, model, status, cost_usd_micro, latency_ms")
      .gte("created_at", since)
      .limit(50_000),
    loadOutcomes(),
  ]);

  if (logRes.error) {
    console.warn("[smart-router] log read failed:", logRes.error.message);
    return {
      builtAt: Date.now(),
      config,
      byFeaturePhase: new Map(),
      byFeature: new Map(),
    };
  }

  const snap = buildSnapshot((logRes.data ?? []) as RawRow[], config, outcomes);
  cached = snap;
  cacheLoadedAt = Date.now();
  return snap;
}

async function getSnapshot(): Promise<RouterSnapshot> {
  const now = Date.now();
  if (cached && now - cacheLoadedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = rebuildSnapshot().finally(() => {
    inflight = null;
  });
  // If we have a stale snapshot, return it immediately and let the rebuild
  // run in the background to keep latency low.
  if (cached) {
    void inflight;
    return cached;
  }
  return inflight;
}

/** Force-refresh on next call (e.g. after an admin config change). */
export function invalidateSmartRouter(): void {
  cached = null;
  cacheLoadedAt = 0;
}

export interface PickArgs {
  feature: AiFeature;
  phase: Phase;
  candidates: string[];
  defaultModel: string;
}

export interface PickResult {
  model: string;
  reason:
    | "router_disabled"
    | "no_data"
    | "exploration"
    | "best_score"
    | "single_candidate"
    | "default_fallback";
  stat: ModelStat | null;
}

/**
 * Pick the best model for a (feature, phase) given the allowed candidates.
 *
 * Strategy:
 *   1. If router disabled → return defaultModel.
 *   2. If only one candidate → return it.
 *   3. With probability `explorationPct`, pick a random under-sampled
 *      candidate (epsilon-greedy exploration).
 *   4. Otherwise: best-scoring model with `enoughData=true` for this
 *      (feature, phase). Falls back to feature-only stats, then default.
 */
export async function pickBestModel(args: PickArgs): Promise<PickResult> {
  if (args.candidates.length === 0) {
    return { model: args.defaultModel, reason: "default_fallback", stat: null };
  }
  if (args.candidates.length === 1) {
    return { model: args.candidates[0], reason: "single_candidate", stat: null };
  }

  let snap: RouterSnapshot;
  try {
    snap = await getSnapshot();
  } catch (e) {
    console.warn("[smart-router] snapshot failed:", e);
    return { model: args.defaultModel, reason: "default_fallback", stat: null };
  }

  if (!snap.config.enabled) {
    return { model: args.defaultModel, reason: "router_disabled", stat: null };
  }

  // Exploration: occasionally try the under-sampled candidate to feed it data.
  const explorationRoll = Math.random() * 100;
  if (explorationRoll < snap.config.explorationPct) {
    const phaseKey = `${args.feature}|${args.phase}`;
    const known = new Map<string, ModelStat>();
    for (const s of snap.byFeaturePhase.get(phaseKey) ?? []) known.set(s.model, s);
    const underSampled = args.candidates.filter(
      (m) => !known.get(m) || !known.get(m)!.enoughData,
    );
    if (underSampled.length > 0) {
      const pick = underSampled[Math.floor(Math.random() * underSampled.length)];
      return {
        model: pick,
        reason: "exploration",
        stat: known.get(pick) ?? null,
      };
    }
  }

  // Exploit: best score from (feature, phase), then (feature), then default.
  const tryRanked = (stats: ModelStat[] | undefined): PickResult | null => {
    if (!stats || stats.length === 0) return null;
    const eligible = stats.filter((s) => args.candidates.includes(s.model) && s.enoughData);
    if (eligible.length === 0) return null;
    const top = eligible[0];
    return { model: top.model, reason: "best_score", stat: top };
  };

  const phaseKey = `${args.feature}|${args.phase}`;
  const fromPhase = tryRanked(snap.byFeaturePhase.get(phaseKey));
  if (fromPhase) return fromPhase;

  const fromFeature = tryRanked(snap.byFeature.get(args.feature));
  if (fromFeature) return fromFeature;

  return { model: args.defaultModel, reason: "no_data", stat: null };
}

/** Snapshot for the admin UI. */
export async function getRouterSnapshot(): Promise<{
  config: RouterConfig;
  builtAt: number;
  perFeaturePhase: Array<{
    feature: string;
    phase: string;
    models: ModelStat[];
  }>;
}> {
  const snap = await getSnapshot();
  const perFeaturePhase: Array<{ feature: string; phase: string; models: ModelStat[] }> = [];
  for (const [key, models] of snap.byFeaturePhase) {
    const [feature, phase] = key.split("|");
    perFeaturePhase.push({ feature, phase, models });
  }
  perFeaturePhase.sort((a, b) =>
    a.feature === b.feature ? a.phase.localeCompare(b.phase) : a.feature.localeCompare(b.feature),
  );
  return { config: snap.config, builtAt: snap.builtAt, perFeaturePhase };
}

export async function setRouterConfig(
  userId: string,
  patch: Partial<RouterConfig>,
): Promise<RouterConfig> {
  const current = await loadConfig();
  const next: RouterConfig = {
    enabled: patch.enabled ?? current.enabled,
    explorationPct: Math.max(0, Math.min(100, patch.explorationPct ?? current.explorationPct)),
    minSamples: Math.max(1, patch.minSamples ?? current.minSamples),
    windowHours: Math.max(1, Math.min(720, patch.windowHours ?? current.windowHours)),
  };
  const { error } = await supabaseAdmin
    .from("ai_router_config")
    .upsert(
      {
        id: 1,
        enabled: next.enabled,
        exploration_pct: next.explorationPct,
        min_samples: next.minSamples,
        window_hours: next.windowHours,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "id" },
    );
  if (error) throw new Error(error.message);
  invalidateSmartRouter();
  return next;
}
