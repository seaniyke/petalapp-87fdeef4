/**
 * Entitlements — the single server-side answer to "does this user get the
 * paid feature set?".
 *
 * Petal sells two ways:
 *   1. Subscription (plan_code <> 'free')
 *   2. Pay as you go — buy a one-off credit pack, no subscription
 *
 * Either one unlocks the same feature set. Pay-as-you-go access lasts for as
 * long as the user still has purchased (top-up) credits remaining; when the
 * balance hits zero they fall back to the free tier until they buy again.
 *
 * Mirrors the `public.has_full_access(uuid)` SQL function so the DB (RLS,
 * triggers) and the app can never disagree.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AccessState = {
  hasFullAccess: boolean;
  planCode: string;
  /** Purchased (top-up) build credits remaining. */
  topupCredits: number;
  /** True when access comes from credits rather than a subscription. */
  payAsYouGo: boolean;
};

export async function getAccessState(userId: string): Promise<AccessState> {
  const { data } = await supabaseAdmin
    .from("user_wallets")
    .select("plan_code, topup_credits_remaining")
    .eq("user_id", userId)
    .maybeSingle();

  const planCode = String(data?.plan_code ?? "free");
  const topupCredits = Number(data?.topup_credits_remaining ?? 0);
  const subscribed = planCode !== "free";
  const payAsYouGo = !subscribed && topupCredits > 0;

  return {
    hasFullAccess: subscribed || topupCredits > 0,
    planCode,
    topupCredits,
    payAsYouGo,
  };
}

/** Convenience boolean form of {@link getAccessState}. */
export async function hasFullAccess(userId: string): Promise<boolean> {
  return (await getAccessState(userId)).hasFullAccess;
}
