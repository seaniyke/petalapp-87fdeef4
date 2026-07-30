/**
 * Server-only business logic for the /admin/ai-providers console.
 *
 * Originally lived in `ai-provider.functions.ts` as `createServerFn` handlers,
 * but `createServerFn` does NOT forward the user's Supabase access token, so
 * the `requireSupabaseAuth` middleware was always rejecting calls with 401.
 * We mirror the pattern from `routes/api/builds/trigger.ts`: do auth + admin
 * checks inside an API route and call these pure helpers.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ALL_AI_FEATURES,
  invalidateProviderCache,
  type AiFeature,
} from "@/server/ai-provider.server";

export type Provider = "lovable" | "openrouter";

export type BudgetConfigRow = {
  feature: AiFeature;
  enabled: boolean;
  allowedModels: string[];
  shadowPct: number;
};

export type AiFeatureRow = {
  feature: AiFeature;
  effective: Provider;
  override: Provider | null;
  envChoice: Provider | null;
  model: string | null;
  fallbackModel: string | null;
  locked: boolean;
  budgetEnabled: boolean;
  budgetModels: string[] | null;
  shadowPct: number | null;
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

export async function assertAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error("Admin check failed");
  if (!data) throw new Error("Forbidden: admin only");
}

export async function listProviderSettings(): Promise<{
  rows: AiFeatureRow[];
  openrouterKeyConfigured: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("feature, provider, model, fallback_model, budget_enabled, budget_models, shadow_pct");
  if (error) throw new Error(error.message);

  type Row = {
    feature: string;
    provider: string | null;
    model: string | null;
    fallback_model: string | null;
    budget_enabled: boolean | null;
    budget_models: string[] | null;
    shadow_pct: number | null;
  };
  const overrides = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) {
    overrides.set(row.feature, row);
  }

  const rows: AiFeatureRow[] = ALL_AI_FEATURES.map((feature) => {
    const r = overrides.get(feature);
    const override =
      r?.provider === "openrouter" || r?.provider === "lovable"
        ? (r.provider as Provider)
        : null;
    const envChoice = envChoiceFor(feature);
    const effective: Provider = override ?? envChoice ?? "lovable";
    return {
      feature,
      effective,
      override,
      envChoice,
      model: r?.model ?? null,
      fallbackModel: r?.fallback_model ?? null,
      locked: false,
      budgetEnabled: r?.budget_enabled ?? true,
      budgetModels: r?.budget_models ?? null,
      shadowPct: r?.shadow_pct ?? null,
    };
  });

  return {
    rows,
    openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  };
}

export type SetProviderInput = {
  feature: AiFeature;
  provider: Provider | null;
  model?: string | null;
  fallbackModel?: string | null;
};

export async function setProviderSetting(
  userId: string,
  input: SetProviderInput,
): Promise<void> {
  if (!ALL_AI_FEATURES.includes(input.feature)) {
    throw new Error(`Unknown feature: ${input.feature}`);
  }
  // Image generation can now route through OpenRouter too — both providers
  // expose Gemini image models via the chat-completions `modalities` shape.
  if (
    input.provider !== null &&
    input.provider !== "lovable" &&
    input.provider !== "openrouter"
  ) {
    throw new Error("provider must be 'lovable', 'openrouter', or null");
  }

  const wantsClear =
    input.provider === null &&
    input.model === undefined &&
    input.fallbackModel === undefined;

  if (wantsClear) {
    const { error } = await supabaseAdmin
      .from("ai_provider_settings")
      .delete()
      .eq("feature", input.feature);
    if (error) throw new Error(error.message);
  } else {
    const { data: existing } = await supabaseAdmin
      .from("ai_provider_settings")
      .select("provider, model, fallback_model")
      .eq("feature", input.feature)
      .maybeSingle();

    const provider =
      input.provider === null ? (existing?.provider ?? "lovable") : input.provider;
    const model =
      input.model === undefined
        ? (existing?.model ?? null)
        : input.model && input.model.trim() !== ""
          ? input.model.trim()
          : null;
    const fallback_model =
      input.fallbackModel === undefined
        ? (existing?.fallback_model ?? null)
        : input.fallbackModel && input.fallbackModel.trim() !== ""
          ? input.fallbackModel.trim()
          : null;

    const { error } = await supabaseAdmin.from("ai_provider_settings").upsert(
      {
        feature: input.feature,
        provider,
        model,
        fallback_model,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "feature" },
    );
    if (error) throw new Error(error.message);
  }

  invalidateProviderCache();
}

export async function getBudgetConfig(): Promise<{ rows: BudgetConfigRow[] }> {
  const { data, error } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("feature, budget_enabled, budget_models, shadow_pct");
  if (error) throw new Error(error.message);

  const rows: BudgetConfigRow[] = ALL_AI_FEATURES.map((feature) => {
    const r = (data ?? []).find((x) => x.feature === feature);
    return {
      feature,
      enabled: r?.budget_enabled ?? true,
      allowedModels: r?.budget_models ?? [],
      shadowPct: r?.shadow_pct ?? 0,
    };
  });
  return { rows };
}

export type SetBudgetInput = {
  feature: AiFeature;
  enabled?: boolean;
  models?: string[];
  shadowPct?: number;
};

export async function setBudgetConfig(userId: string, input: SetBudgetInput): Promise<void> {
  if (!ALL_AI_FEATURES.includes(input.feature)) {
    throw new Error(`Unknown feature: ${input.feature}`);
  }
  const { data: existing } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("feature, provider, model, fallback_model, budget_enabled, budget_models, shadow_pct")
    .eq("feature", input.feature)
    .maybeSingle();

  const next = {
    feature: input.feature,
    provider: existing?.provider ?? "lovable",
    model: existing?.model ?? null,
    fallback_model: existing?.fallback_model ?? null,
    budget_enabled:
      input.enabled === undefined ? (existing?.budget_enabled ?? true) : input.enabled,
    budget_models:
      input.models === undefined
        ? (existing?.budget_models ?? null)
        : input.models.length > 0
          ? input.models
          : null,
    shadow_pct:
      input.shadowPct === undefined ? (existing?.shadow_pct ?? 0) : Math.max(0, input.shadowPct),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabaseAdmin.from("ai_provider_settings").upsert(next, {
    onConflict: "feature",
  });
  if (error) throw new Error(error.message);
  invalidateProviderCache();
}

export async function getCostSummary(daysInput: number | undefined): Promise<{
  days: number;
  rows: AiCostRow[];
  totalCalls: number;
  totalCostUsdMicro: number;
  totalErrors: number;
}> {
  const days = Math.min(Math.max(daysInput ?? 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await supabaseAdmin
    .from("ai_call_log")
    .select("feature, provider, model, status, total_tokens, cost_usd_micro")
    .gte("created_at", since)
    .limit(50_000);
  if (error) throw new Error(error.message);

  const buckets = new Map<string, AiCostRow>();
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

  return { days, rows, totalCalls, totalCostUsdMicro, totalErrors };
}
