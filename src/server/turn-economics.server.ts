/**
 * Per-turn economics recording.
 *
 * One row per user request in `turn_economics`, holding what the customer was
 * charged alongside what the turn actually cost Kimble in variable spend.
 *
 * Honesty rules (non-negotiable):
 *   - A cost we could not determine is recorded as NULL with cost_basis
 *     'unknown'. We never write a fake $0.
 *   - 'actual' means the provider reported a real amount. 'estimated' means
 *     we derived it from tokens/minutes at a configured internal rate.
 *   - Mixed evidence downgrades to 'estimated', and any missing AI cost on a
 *     turn that made AI calls downgrades to 'unknown'.
 *
 * Nothing here is shown to customers. It is admin/internal accounting only,
 * and every write is best-effort: a failure must never break a build.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValues } from "@/server/economics-config.server";
import { aiRowToCostEvent, classifyTurnCalls, recordCostEvents } from "@/server/cost-events.server";

export type CostBasis = "actual" | "estimated" | "unknown";

export type RecordTurnEconomicsArgs = {
  turnId: string;
  userId?: string | null;
  projectId?: string | null;
  buildId?: string | null;
  feature?: string;
  creditsCharged: number;
  agentRounds?: number;
  imagesGenerated?: number;
  retryCount?: number;
  isAutoFix?: boolean;
  result?: string | null;
  metadata?: Record<string, unknown>;
};

type AiRollup = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  models: string[];
  providers: string[];
  costUsdMicro: number | null;
  basis: CostBasis;
};

/**
 * Roll up every AI call belonging to this turn. Calls are matched by
 * `turn_id` where the pipeline stamped one, which is the reliable path;
 * turns with no stamped calls report zero calls and an unknown cost rather
 * than guessing from a time window.
 */
async function rollUpAiCalls(turnId: string): Promise<AiRollup> {
  const empty: AiRollup = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    models: [],
    providers: [],
    costUsdMicro: null,
    basis: "unknown",
  };
  try {
    const { data } = await supabaseAdmin
      .from("ai_call_log")
      .select(
        "model, provider, prompt_tokens, completion_tokens, cached_prompt_tokens, cost_usd_micro, cost_basis",
      )
      .eq("turn_id", turnId);
    if (!data?.length) return empty;

    const models = new Set<string>();
    const providers = new Set<string>();
    let prompt = 0;
    let completion = 0;
    let cached = 0;
    let cost = 0;
    let sawActual = false;
    let sawEstimated = false;
    let sawUnknown = false;

    for (const row of data) {
      if (row.model) models.add(row.model);
      if (row.provider) providers.add(row.provider);
      prompt += Number(row.prompt_tokens ?? 0);
      completion += Number(row.completion_tokens ?? 0);
      cached += Number(row.cached_prompt_tokens ?? 0);
      const c = row.cost_usd_micro == null ? null : Number(row.cost_usd_micro);
      if (c == null) {
        sawUnknown = true;
        continue;
      }
      cost += c;
      if (row.cost_basis === "actual") sawActual = true;
      else sawEstimated = true;
    }

    // Any call with no cost at all makes the turn total unknowable.
    const basis: CostBasis = sawUnknown
      ? "unknown"
      : sawActual && !sawEstimated
        ? "actual"
        : "estimated";

    return {
      calls: data.length,
      promptTokens: prompt,
      completionTokens: completion,
      cachedPromptTokens: cached,
      models: [...models],
      providers: [...providers],
      costUsdMicro: sawUnknown ? null : Math.round(cost),
      basis,
    };
  } catch (err) {
    console.warn("[turn-economics] ai rollup failed", err);
    return empty;
  }
}

/**
 * Write (or refresh) the economics record for a turn. Safe to call twice —
 * the row is keyed on turn_id, so a retried settlement updates rather than
 * duplicating.
 */
export async function recordTurnEconomics(args: RecordTurnEconomicsArgs): Promise<void> {
  try {
    const ai = await rollUpAiCalls(args.turnId);
    const rates = await economicsValues();

    const imageCostMicro =
      (args.imagesGenerated ?? 0) > 0
        ? Math.round((args.imagesGenerated ?? 0) * rates.image_generation_usd * 1_000_000)
        : 0;

    // Build/verify/deploy timings are attached later by the builder callback;
    // at settlement time only the AI and image legs are known.
    const otherCostMicro = imageCostMicro;
    const variableCostMicro =
      ai.costUsdMicro == null ? null : ai.costUsdMicro + otherCostMicro;

    await supabaseAdmin.from("turn_economics").upsert(
      {
        turn_id: args.turnId,
        user_id: args.userId ?? null,
        project_id: args.projectId ?? null,
        build_id: args.buildId ?? null,
        feature: args.feature ?? "generate",
        credits_charged: args.creditsCharged,
        ai_calls: ai.calls,
        prompt_tokens: ai.promptTokens,
        completion_tokens: ai.completionTokens,
        cached_prompt_tokens: ai.cachedPromptTokens,
        models: ai.models as never,
        providers: ai.providers as never,
        agent_rounds: args.agentRounds ?? 0,
        images_generated: args.imagesGenerated ?? 0,
        retry_count: args.retryCount ?? 0,
        ai_cost_usd_micro: ai.costUsdMicro,
        other_cost_usd_micro: otherCostMicro,
        variable_cost_usd_micro: variableCostMicro,
        cost_basis: ai.basis,
        result: args.result ?? null,
        is_auto_fix: args.isAutoFix ?? false,
        metadata: (args.metadata as never) ?? {},
      },
      { onConflict: "turn_id" },
    );
    await syncTurnCosts(args.turnId);
  } catch (err) {
    console.warn("[turn-economics] record failed", err);
  }
}

/**
 * Mirror every AI call of the turn into cost_events (ACTUAL where OpenRouter
 * reported a cost), stamp call classes, and split credits into free-build vs
 * paid from the ledger. Idempotent; safe to call again after builds finish.
 */
export async function syncTurnCosts(turnId: string): Promise<void> {
  try {
    const { data: rows } = await supabaseAdmin
      .from("ai_call_log")
      .select("id, user_id, project_id, turn_id, stage, purpose, call_kind, model, upstream_provider, provider, prompt_tokens, completion_tokens, reasoning_tokens, cache_write_tokens, cost_usd_micro, cost_basis, status, created_at")
      .eq("turn_id", turnId)
      .order("created_at", { ascending: true });
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    await recordCostEvents(list.map((r) => aiRowToCostEvent(r as never)));
    const classes = classifyTurnCalls(list as never);
    for (let i = 0; i < list.length; i++) {
      await supabaseAdmin.from("ai_call_log").update({ call_class: classes[i] } as never).eq("id", list[i].id as string);
    }
    const count = (c: string) => classes.filter((x) => x === c).length;
    const { data: te } = await supabaseAdmin
      .from("turn_economics").select("user_id, project_id, created_at").eq("turn_id", turnId).maybeSingle();
    let free = 0;
    let paid = 0;
    if (te?.user_id && te.project_id) {
      // Exact: the charge(s) of this turn's own operation. No time windows.
      const { data: led } = await supabaseAdmin
        .from("credit_ledger").select("delta, reason, metadata, operation_id")
        .eq("turn_id", turnId).eq("reason", "ai_build_charge").lt("delta", 0);
      for (const row of led ?? []) {
        const m = (row.metadata ?? {}) as { sources?: Array<{ bucket: string; amount: number }> };
        for (const s of m.sources ?? []) {
          if (s.bucket === "daily_free") free += Number(s.amount);
          else paid += Number(s.amount);
        }
      }
    }
    await supabaseAdmin
      .from("turn_economics")
      .update({
        reasoning_tokens: list.reduce((a, r) => a + Number(r.reasoning_tokens ?? 0), 0),
        cache_write_tokens: list.reduce((a, r) => a + Number(r.cache_write_tokens ?? 0), 0),
        redundant_calls: count("REDUNDANT"),
        retry_calls: count("RETRY"),
        recovery_calls: count("RECOVERY"),
        verification_calls: count("VERIFICATION"),
        free_credits_charged: free,
        paid_credits_charged: paid,
        settlement_state: "settled",
      } as never)
      .eq("turn_id", turnId);
  } catch (err) {
    console.warn("[turn-economics] cost sync failed", err);
  }
}

/** Attach builder timings + derived build cost once a build finishes. */
export async function attachBuildEconomics(args: {
  turnId?: string | null;
  projectId?: string | null;
  buildId: string;
  buildMs?: number | null;
  verifyMs?: number | null;
  deployMs?: number | null;
  result?: string | null;
}): Promise<void> {
  if (!args.turnId) return;
  try {
    const rates = await economicsValues();
    const buildMinutes = (args.buildMs ?? 0) / 60_000;
    const verifyMinutes = (args.verifyMs ?? 0) / 60_000;
    const buildCostUsd =
      buildMinutes * rates.build_minute_usd +
      verifyMinutes * rates.verification_minute_usd +
      (args.deployMs != null ? rates.deploy_event_usd : 0);
    const buildCostMicro =
      args.buildMs == null && args.verifyMs == null
        ? null
        : Math.round(buildCostUsd * 1_000_000);

    const { data: existing } = await supabaseAdmin
      .from("turn_economics")
      .select("ai_cost_usd_micro, other_cost_usd_micro")
      .eq("turn_id", args.turnId)
      .maybeSingle();

    const aiCost = existing?.ai_cost_usd_micro == null ? null : Number(existing.ai_cost_usd_micro);
    const otherCost = Number(existing?.other_cost_usd_micro ?? 0);
    const variable =
      aiCost == null || buildCostMicro == null ? null : aiCost + otherCost + buildCostMicro;

    // Build/browser compute: rate-derived, so ESTIMATED — never ACTUAL.
    await recordCostEvents([
      {
        sourceRef: `build:${args.buildId}`,
        projectId: args.projectId ?? null,
        turnId: args.turnId,
        buildId: args.buildId,
        stage: "build",
        category: "BUILD_COMPUTE",
        provider: "railway",
        resource: "builder",
        quantity: args.buildMs == null ? null : buildMinutes,
        unit: "minutes",
        costUsd: args.buildMs == null ? null : buildMinutes * rates.build_minute_usd,
        basis: "ESTIMATED",
        failedWork: args.result !== "ready",
        metadata: { rate_usd_per_minute: rates.build_minute_usd },
      },
      {
        sourceRef: `browser:${args.buildId}`,
        projectId: args.projectId ?? null,
        turnId: args.turnId,
        buildId: args.buildId,
        stage: "verify",
        category: "BROWSER_COMPUTE",
        provider: "railway",
        resource: "playwright",
        quantity: args.verifyMs == null ? null : verifyMinutes,
        unit: "minutes",
        costUsd: args.verifyMs == null ? null : verifyMinutes * rates.verification_minute_usd,
        basis: "ESTIMATED",
        failedWork: args.result !== "ready",
        metadata: { rate_usd_per_minute: rates.verification_minute_usd },
      },
    ]);
    await supabaseAdmin
      .from("project_builds")
      .update({ turn_id: args.turnId } as never)
      .eq("id", args.buildId)
      .is("turn_id" as never, null);
    await supabaseAdmin
      .from("turn_economics")
      .update({
        build_id: args.buildId,
        build_ms: args.buildMs ?? null,
        verify_ms: args.verifyMs ?? null,
        deploy_ms: args.deployMs ?? null,
        build_cost_usd_micro: buildCostMicro,
        variable_cost_usd_micro: variable,
        result: args.result ?? null,
      })
      .eq("turn_id", args.turnId);
  } catch (err) {
    console.warn("[turn-economics] build attach failed", err);
  }
}

/** Record a refund against a turn so contribution reflects money given back. */
export async function recordTurnRefund(turnId: string, credits: number): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("turn_economics")
      .select("credits_refunded")
      .eq("turn_id", turnId)
      .maybeSingle();
    if (!data) return;
    await supabaseAdmin
      .from("turn_economics")
      .update({ credits_refunded: Number(data.credits_refunded ?? 0) + credits })
      .eq("turn_id", turnId);
  } catch (err) {
    console.warn("[turn-economics] refund record failed", err);
  }
}

// NOTE: the former attachBuildEconomicsByProject ("newest turn on the project
// within an hour" + time-window linking of browser calls) was removed. Builds
// are attributed only through their own operation/turn id; otherwise UNKNOWN.
