/**
 * Internal economics configuration.
 *
 * Every internal rate Petal uses to value its own variable cost lives in the
 * `economics_config` table so margins can be tuned without a code change.
 * The constants below are DEFAULTS ONLY — they exist so behaviour is identical
 * on day one and so a config read failure can never break a build.
 *
 * NOTHING in this module is customer-facing. These numbers are internal cost
 * assumptions, not prices. Customer prices live in billing_plans / credit_packs
 * and are never derived from here.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EconomicsKey =
  | "target_variable_cost_per_credit_usd"
  | "build_minute_usd"
  | "verification_minute_usd"
  | "deploy_event_usd"
  | "image_generation_usd"
  | "min_purchase_ngn"
  | "target_gross_margin_pct"
  | "free_user_monthly_cost_ceiling_usd";

export const ECONOMICS_DEFAULTS: Record<EconomicsKey, number> = {
  target_variable_cost_per_credit_usd: 0.05,
  build_minute_usd: 0.02,
  verification_minute_usd: 0.02,
  deploy_event_usd: 0.002,
  image_generation_usd: 0.02,
  min_purchase_ngn: 5000,
  target_gross_margin_pct: 60,
  free_user_monthly_cost_ceiling_usd: 1.5,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; values: Record<string, number> } | null = null;

async function load(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;
  const values: Record<string, number> = { ...ECONOMICS_DEFAULTS };
  try {
    const { data } = await supabaseAdmin.from("economics_config").select("key, value");
    for (const row of data ?? []) {
      const n = Number(row.value);
      if (Number.isFinite(n)) values[row.key] = n;
    }
  } catch (err) {
    console.warn("[economics-config] read failed, using defaults", err);
  }
  cache = { at: Date.now(), values };
  return values;
}

/** Read one internal rate. Falls back to the compiled default. */
export async function economicsValue(key: EconomicsKey): Promise<number> {
  const values = await load();
  return values[key] ?? ECONOMICS_DEFAULTS[key];
}

/** Read every internal rate at once (admin dashboard, cost roll-ups). */
export async function economicsValues(): Promise<Record<EconomicsKey, number>> {
  const values = await load();
  return { ...ECONOMICS_DEFAULTS, ...values } as Record<EconomicsKey, number>;
}

/** Drop the cache after an admin edit so the next read sees the new rate. */
export function invalidateEconomicsCache(): void {
  cache = null;
}
