/**
 * Month-to-date credit usage, split the way customers think about it:
 * builds (Petal writing code) vs Cloud vs AI.
 *
 * There is ONE balance — Petal Credits. Cloud and AI meters are recorded in
 * cents in `runtime_ledger` for internal economics, so they are converted to
 * credits here at the same central rate the charge used.
 */
import { supabase } from "@/integrations/supabase/client";

/** Internal variable cost covered by one credit (USD). Mirrors
 *  economics_config.target_variable_cost_per_credit_usd. */
export const USD_PER_CREDIT = 0.05;

export function centsToCredits(cents: number): number {
  return Math.round((cents / 100 / USD_PER_CREDIT) * 100) / 100;
}

export type CreditUsage = {
  buildCredits: number;
  cloudCredits: number;
  aiCredits: number;
  totalCredits: number;
};

function startOfMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function fetchCreditUsage(userId: string): Promise<CreditUsage> {
  const since = startOfMonthIso();

  const [{ data: ledger }, { data: runtime }] = await Promise.all([
    supabase
      .from("credit_ledger")
      .select("delta, reason")
      .eq("user_id", userId)
      .lt("delta", 0)
      .gte("created_at", since),
    supabase
      .from("runtime_ledger")
      .select("meter, delta_cents")
      .eq("user_id", userId)
      .lt("delta_cents", 0)
      .gte("created_at", since),
  ]);

  let cloudCredits = 0;
  let aiCredits = 0;
  for (const r of runtime ?? []) {
    const credits = centsToCredits(Math.abs(Number(r.delta_cents)));
    if (r.meter === "app_ai" || r.meter === "image_gen") aiCredits += credits;
    else cloudCredits += credits;
  }

  // Everything charged to credits that isn't a Cloud/AI meter is build work.
  let buildCredits = 0;
  for (const r of ledger ?? []) {
    if (r.reason === "runtime_charge" || r.reason === "runtime_fallback") continue;
    buildCredits += Math.abs(Number(r.delta));
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    buildCredits: round(buildCredits),
    cloudCredits: round(cloudCredits),
    aiCredits: round(aiCredits),
    totalCredits: round(buildCredits + cloudCredits + aiCredits),
  };
}

/** Format a credit amount: whole numbers plain, fractions to 2dp. */
export function formatCredits(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}
