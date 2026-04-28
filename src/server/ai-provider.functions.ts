/**
 * Server functions for /admin/ai-providers.
 *
 * Reads / writes:
 *   - `ai_provider_settings` (provider override + model + fallback model)
 *   - `ai_call_log` (read-only rollup for the cost dashboard)
 *
 * All routes are guarded by:
 *   1. requireSupabaseAuth — must be signed in.
 *   2. Explicit `has_role(uid, 'admin')` check inside the handler — RLS would
 *      also block non-admins, but we surface a clean 403 instead of an opaque
 *      Postgres error.
 *
 * After any write we call `invalidateProviderCache()` so the next AI request
 * reflects the change immediately.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ALL_AI_FEATURES,
  invalidateProviderCache,
  type AiFeature,
} from "@/server/ai-provider.server";

type Provider = "lovable" | "openrouter";

export type AiFeatureRow = {
  feature: AiFeature;
  /** Effective provider after DB → env → default cascade. */
  effective: Provider;
  /** What the DB actually has (null = no override, falls back to env/default). */
  override: Provider | null;
  /** What the env vars say, for transparency. */
  envChoice: Provider | null;
  /** Model override stored in DB (null = use caller-supplied default). */
  model: string | null;
  /** Fallback model retried once on 429/402/5xx. */
  fallbackModel: string | null;
  /** Locked features can't be changed (currently: image gen). */
  locked: boolean;
};

export type AiCostRow = {
  feature: AiFeature;
  provider: Provider;
  model: string | null;
  calls: number;
  totalTokens: number;
  costUsdMicro: number;
  errorCalls: number;
};

function envChoiceFor(feature: AiFeature): Provider | null {
  const perFeature = process.env[`AI_PROVIDER_${feature.toUpperCase()}`]?.toLowerCase();
  const global = process.env.AI_PROVIDER?.toLowerCase();
  const choice = perFeature || global;
  if (choice === "openrouter") return "openrouter";
  if (choice === "lovable") return "lovable";
  return null;
}

async function assertAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error("Admin check failed");
  if (!data) throw new Error("Forbidden: admin only");
}

/**
 * List every feature with its current effective provider, model override,
 * and fallback model. Source of truth for the admin UI.
 */
export const listAiProviderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    rows: AiFeatureRow[];
    openrouterKeyConfigured: boolean;
  }> => {
    await assertAdmin(context.userId);

    const { data, error } = await supabaseAdmin
      .from("ai_provider_settings")
      .select("feature, provider, model, fallback_model");
    if (error) throw new Error(error.message);

    type Row = {
      feature: string;
      provider: string | null;
      model: string | null;
      fallback_model: string | null;
    };
    const overrides = new Map<string, Row>();
    for (const row of (data ?? []) as Row[]) {
      overrides.set(row.feature, row);
    }

    const rows: AiFeatureRow[] = ALL_AI_FEATURES.map((feature) => {
      const locked = feature === "image";
      const r = overrides.get(feature);
      const override =
        r?.provider === "openrouter" || r?.provider === "lovable" ? r.provider : null;
      const envChoice = envChoiceFor(feature);
      const effective: Provider = locked
        ? "lovable"
        : (override ?? envChoice ?? "lovable");
      return {
        feature,
        effective,
        override,
        envChoice,
        model: r?.model ?? null,
        fallbackModel: r?.fallback_model ?? null,
        locked,
      };
    });

    return {
      rows,
      openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    };
  });

/**
 * Set (or clear) the override for a single feature. `provider: null` clears.
 * Optional `model` / `fallbackModel` updates are applied on the same row.
 */
export const setAiProviderSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      feature: AiFeature;
      provider: Provider | null;
      // Undefined = leave untouched. Empty string / null = clear the column.
      model?: string | null;
      fallbackModel?: string | null;
    }) => {
      if (!ALL_AI_FEATURES.includes(input.feature)) {
        throw new Error(`Unknown feature: ${input.feature}`);
      }
      if (input.feature === "image") {
        throw new Error("Image generation is hard-pinned to Lovable AI and cannot be changed.");
      }
      if (
        input.provider !== null &&
        input.provider !== "lovable" &&
        input.provider !== "openrouter"
      ) {
        throw new Error("provider must be 'lovable', 'openrouter', or null");
      }
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId);

    const wantsClear =
      data.provider === null && data.model === undefined && data.fallbackModel === undefined;

    if (wantsClear) {
      const { error } = await supabaseAdmin
        .from("ai_provider_settings")
        .delete()
        .eq("feature", data.feature);
      if (error) throw new Error(error.message);
    } else {
      // Read existing row to preserve untouched fields.
      const { data: existing } = await supabaseAdmin
        .from("ai_provider_settings")
        .select("provider, model, fallback_model")
        .eq("feature", data.feature)
        .maybeSingle();

      const provider =
        data.provider === null ? (existing?.provider ?? "lovable") : data.provider;
      const model =
        data.model === undefined
          ? (existing?.model ?? null)
          : data.model && data.model.trim() !== ""
            ? data.model.trim()
            : null;
      const fallback_model =
        data.fallbackModel === undefined
          ? (existing?.fallback_model ?? null)
          : data.fallbackModel && data.fallbackModel.trim() !== ""
            ? data.fallbackModel.trim()
            : null;

      const { error } = await supabaseAdmin.from("ai_provider_settings").upsert(
        {
          feature: data.feature,
          provider,
          model,
          fallback_model,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        },
        { onConflict: "feature" },
      );
      if (error) throw new Error(error.message);
    }

    invalidateProviderCache();
    return { ok: true };
  });

/**
 * Cost & usage rollup for the dashboard.
 * Aggregates the last `days` (default 7) of `ai_call_log` rows.
 */
export const getAiCostSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(Math.max(input?.days ?? 7, 1), 90),
  }))
  .handler(async ({ data, context }): Promise<{
    days: number;
    rows: AiCostRow[];
    totalCalls: number;
    totalCostUsdMicro: number;
    totalErrors: number;
  }> => {
    await assertAdmin(context.userId);

    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();

    // Pull raw rows and aggregate in JS — keeps the server function portable
    // across Postgres versions and avoids RPC plumbing for a single query.
    const { data: logs, error } = await supabaseAdmin
      .from("ai_call_log")
      .select("feature, provider, model, status, total_tokens, cost_usd_micro")
      .gte("created_at", since)
      .limit(50_000); // Hard cap; an admin can shorten the window if needed.
    if (error) throw new Error(error.message);

    type Key = string;
    const buckets = new Map<Key, AiCostRow>();
    let totalCalls = 0;
    let totalCostUsdMicro = 0;
    let totalErrors = 0;

    for (const r of logs ?? []) {
      const provider: Provider = r.provider === "openrouter" ? "openrouter" : "lovable";
      const key = `${r.feature}|${provider}|${r.model ?? ""}`;
      let row = buckets.get(key);
      if (!row) {
        row = {
          feature: r.feature as AiFeature,
          provider,
          model: r.model ?? null,
          calls: 0,
          totalTokens: 0,
          costUsdMicro: 0,
          errorCalls: 0,
        };
        buckets.set(key, row);
      }
      row.calls += 1;
      row.totalTokens += r.total_tokens ?? 0;
      row.costUsdMicro += r.cost_usd_micro ?? 0;
      const isError = typeof r.status === "number" && r.status >= 400;
      if (isError) row.errorCalls += 1;

      totalCalls += 1;
      totalCostUsdMicro += r.cost_usd_micro ?? 0;
      if (isError) totalErrors += 1;
    }

    const rows = [...buckets.values()].sort((a, b) => b.calls - a.calls);

    return {
      days: data.days,
      rows,
      totalCalls,
      totalCostUsdMicro,
      totalErrors,
    };
  });
