/**
 * Client-side helpers for the billing system.
 *
 * The wallet is the source of "how many credits do I have right now". The
 * ledger is the audit log. Subscription/payment flows live in /api/billing/*
 * and are added in Deploy 2 — keep this file purely about reading state for now.
 */
import { supabase } from "@/integrations/supabase/client";

export type BillingPlanCode = "free" | "pro" | "business";

export type Wallet = {
  user_id: string;
  plan_code: BillingPlanCode;
  monthly_credits_remaining: number;
  topup_credits_remaining: number;
  daily_free_used: number;
  daily_free_reset_at: string;
  monthly_free_used: number;
  monthly_free_reset_at: string;
  subscription_status: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export type CreditPack = {
  code: string;
  name: string;
  credits: number;
  price_cents: number;
  stripe_price_id: string | null;
};

export type Plan = {
  code: BillingPlanCode;
  name: string;
  tier: BillingPlanCode;
  monthly_credits: number;
  daily_free_credits: number;
  monthly_free_cap: number | null;
  price_cents: number;
  features: Record<string, boolean | string | number>;
};

export type CreditBreakdown = {
  daily: number;     // remaining today (capped by monthly_free_cap if set)
  monthly: number;   // remaining from paid plan
  topup: number;     // remaining from purchased packs
  total: number;
};

export function computeBreakdown(wallet: Wallet | null, plan: Plan | null): CreditBreakdown {
  if (!wallet || !plan) return { daily: 0, monthly: 0, topup: 0, total: 0 };
  const dailyAllowance = Math.max(0, plan.daily_free_credits - wallet.daily_free_used);
  const monthlyRoom =
    plan.monthly_free_cap == null
      ? Infinity
      : Math.max(0, plan.monthly_free_cap - wallet.monthly_free_used);
  const daily = Math.min(dailyAllowance, monthlyRoom);
  const monthly = wallet.monthly_credits_remaining;
  const topup = wallet.topup_credits_remaining;
  return { daily, monthly, topup, total: daily + monthly + topup };
}

export async function fetchWallet(userId: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from("user_wallets")
    .select(
      "user_id, plan_code, monthly_credits_remaining, topup_credits_remaining, daily_free_used, daily_free_reset_at, monthly_free_used, monthly_free_reset_at, subscription_status, current_period_end, stripe_customer_id, stripe_subscription_id"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Wallet | null) ?? null;
}

export async function fetchPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from("billing_plans")
    .select(
      "code, name, tier, monthly_credits, daily_free_credits, monthly_free_cap, price_cents, features"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function fetchCreditPacks(): Promise<CreditPack[]> {
  const { data, error } = await supabase
    .from("credit_packs")
    .select("code, name, credits, price_cents, stripe_price_id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CreditPack[];
}
