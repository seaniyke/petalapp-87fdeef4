/**
 * Client-side helpers for the billing system.
 *
 * The wallet is the source of "how many credits do I have right now". The
 * ledger is the audit log. Plans/packs are priced in USD; the BillingSheet
 * converts to the user's chosen currency at render time using the catalog
 * here (rates) and admin overrides.
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
  preferred_currency: string;
};

export type CreditPack = {
  code: string;
  name: string;
  credits: number;
  price_cents: number;
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
  daily: number;
  monthly: number;
  topup: number;
  total: number;
};

export type BillingCurrency = {
  code: string;
  name: string;
  symbol: string;
  usd_rate: number;
  is_active: boolean;
  paystack_supported: boolean;
  sort_order: number;
};

export type PriceOverride = {
  item_kind: "plan" | "pack" | "addon";
  item_code: string;
  currency_code: string;
  amount_minor: number;
};

export const SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
};

/**
 * Mirror of `public.check_credit_balance` — including its "reset on a new
 * UTC day/month" logic. Without the reset the badge kept showing yesterday's
 * exhausted allowance (0 left) while the server happily allowed the turn.
 */
export function computeBreakdown(wallet: Wallet | null, plan: Plan | null): CreditBreakdown {
  if (!wallet || !plan) return { daily: 0, monthly: 0, topup: 0, total: 0 };

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const thisMonth = today.slice(0, 7);

  const dailyReset = String(wallet.daily_free_reset_at ?? "").slice(0, 10);
  const monthlyReset = String(wallet.monthly_free_reset_at ?? "").slice(0, 7);

  const dailyUsed = dailyReset && dailyReset < today ? 0 : wallet.daily_free_used;
  const monthlyUsed = monthlyReset && monthlyReset < thisMonth ? 0 : wallet.monthly_free_used;

  const dailyAllowance = Math.max(0, plan.daily_free_credits - dailyUsed);
  const monthlyRoom =
    plan.monthly_free_cap == null
      ? Infinity
      : Math.max(0, plan.monthly_free_cap - monthlyUsed);
  const daily = Math.min(dailyAllowance, monthlyRoom);
  const monthly = wallet.monthly_credits_remaining;
  const topup = wallet.topup_credits_remaining;
  return { daily, monthly, topup, total: daily + monthly + topup };
}

/**
 * Does this user get the paid feature set?
 *
 * Two ways to qualify, and they're equal:
 *   - an active subscription (plan_code !== "free"), or
 *   - pay as you go: purchased credits still remaining.
 *
 * Mirrors `public.has_full_access(uuid)` in the database.
 */
export function hasFullAccess(wallet: Wallet | null | undefined): boolean {
  if (!wallet) return false;
  return wallet.plan_code !== "free" || Number(wallet.topup_credits_remaining ?? 0) > 0;
}

/** True when access is coming from purchased credits rather than a plan. */
export function isPayAsYouGo(wallet: Wallet | null | undefined): boolean {
  if (!wallet) return false;
  return wallet.plan_code === "free" && Number(wallet.topup_credits_remaining ?? 0) > 0;
}


export async function fetchWallet(userId: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from("user_wallets")
    .select(
      "user_id, plan_code, monthly_credits_remaining, topup_credits_remaining, daily_free_used, daily_free_reset_at, monthly_free_used, monthly_free_reset_at, subscription_status, current_period_end, preferred_currency"
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
    .select("code, name, credits, price_cents")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CreditPack[];
}

export async function fetchCurrencies(): Promise<BillingCurrency[]> {
  const { data, error } = await supabase
    .from("billing_currencies")
    .select("code, name, symbol, usd_rate, is_active, paystack_supported, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, usd_rate: Number(c.usd_rate) })) as BillingCurrency[];
}

/**
 * Displayed price overrides for active, purchasable items.
 *
 * The underlying table is admin-only (internal pricing data), so this goes
 * through a controlled server endpoint that returns just what the storefront
 * needs. Admin tooling reads the table directly instead.
 */
export async function fetchPriceOverrides(): Promise<PriceOverride[]> {
  const { getPublicPriceOverrides } = await import("./billing-pricing.functions");
  const data = await getPublicPriceOverrides();
  return data as PriceOverride[];
}

/** Admin-only: full override list read straight from the table. */
export async function fetchAllPriceOverrides(): Promise<PriceOverride[]> {
  const { data, error } = await supabase
    .from("billing_price_overrides")
    .select("item_kind, item_code, currency_code, amount_minor");
  if (error) throw error;
  return (data ?? []).map((o) => ({
    ...o,
    amount_minor: Number(o.amount_minor),
  })) as PriceOverride[];
}

/**
 * Convert a USD-cents price to the local currency's minor units, applying
 * any admin override first. Returns the amount in MINOR units (e.g. kobo).
 */
export function convertPrice(args: {
  itemKind: "plan" | "pack" | "addon";
  itemCode: string;
  usdCents: number;
  currency: string;
  currencies: BillingCurrency[];
  overrides: PriceOverride[];
}): { amountMinor: number; source: "override" | "rate" } {
  const cur = args.currency.toUpperCase();
  const ov = args.overrides.find(
    (o) => o.item_kind === args.itemKind && o.item_code === args.itemCode && o.currency_code === cur,
  );
  if (ov) return { amountMinor: ov.amount_minor, source: "override" };
  if (cur === "USD") return { amountMinor: args.usdCents, source: "rate" };
  const c = args.currencies.find((x) => x.code === cur);
  if (!c) return { amountMinor: args.usdCents, source: "rate" };
  const decimals = CURRENCY_DECIMALS[cur] ?? 2;
  const localMajor = (args.usdCents / 100) * c.usd_rate;
  return { amountMinor: Math.ceil(localMajor * Math.pow(10, decimals)), source: "rate" };
}

/**
 * Format a minor-unit amount in a currency for display, e.g. ₦24,000.
 */
export function formatMoney(amountMinor: number, currency: BillingCurrency): string {
  const decimals = CURRENCY_DECIMALS[currency.code] ?? 2;
  const major = amountMinor / Math.pow(10, decimals);
  const formatted =
    major >= 100
      ? major.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency.symbol}${formatted}`;
}
