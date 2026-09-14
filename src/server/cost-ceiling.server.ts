/**
 * Monthly variable-cost ceiling for free accounts.
 *
 * A small number of free accounts can consume an outsized share of model
 * spend. Rather than cutting them off — which reads as a broken product and
 * kills the very trial we're paying for — we degrade gracefully: once an
 * account passes the month's cost ceiling, its turns are routed to the cheap
 * model and the optional extra agent rounds are dropped. The build still
 * runs. The user is never told about an internal cost ceiling.
 *
 * Paid accounts are never degraded here; their spend is protected by plan
 * limits and the per-turn repair ceiling instead.
 *
 * Every read fails open: if we cannot establish the month's cost, we do not
 * degrade. Under-charging is recoverable; refusing a paying customer is not.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValue } from "@/server/economics-config.server";

export type CeilingVerdict = {
  /** Route this turn to the cheapest capable model and skip extra rounds. */
  degrade: boolean;
  /** Month-to-date variable cost we can actually account for, in USD. */
  monthCostUsd: number;
  ceilingUsd: number;
  reason: "paid" | "under_ceiling" | "over_ceiling" | "unknown";
};

const OPEN: CeilingVerdict = {
  degrade: false,
  monthCostUsd: 0,
  ceilingUsd: 0,
  reason: "unknown",
};

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function evaluateCostCeiling(userId: string): Promise<CeilingVerdict> {
  try {
    const { data: paid } = await supabaseAdmin.rpc("is_paid_plan", { _user_id: userId });
    if (paid === true) {
      return { degrade: false, monthCostUsd: 0, ceilingUsd: 0, reason: "paid" };
    }

    const ceilingUsd = await economicsValue("free_user_monthly_cost_ceiling_usd");
    const { data, error } = await supabaseAdmin
      .from("turn_economics")
      .select("variable_cost_usd_micro, cost_basis")
      .eq("user_id", userId)
      .gte("created_at", startOfMonthIso())
      .limit(2000);
    if (error) return OPEN;

    let total = 0;
    for (const row of (data ?? []) as unknown as Array<{
      variable_cost_usd_micro: number | null;
      cost_basis: string | null;
    }>) {
      // An unknown-cost turn contributes nothing rather than a made-up
      // number. That biases the ceiling towards leniency, which is the
      // direction we want to be wrong in.
      if (row.cost_basis === "unknown") continue;
      total += Number(row.variable_cost_usd_micro ?? 0) / 1_000_000;
    }

    const monthCostUsd = Math.round(total * 10000) / 10000;
    return {
      degrade: monthCostUsd >= ceilingUsd,
      monthCostUsd,
      ceilingUsd,
      reason: monthCostUsd >= ceilingUsd ? "over_ceiling" : "under_ceiling",
    };
  } catch (err) {
    console.warn("[cost-ceiling] evaluation failed, allowing turn", err);
    return OPEN;
  }
}
