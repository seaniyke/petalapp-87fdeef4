/**
 * Server-side helpers for resolving the local-currency price of a plan or
 * top-up pack, given the catalog rate and any admin override.
 *
 * USD is the source of truth (price_cents on billing_plans / credit_packs).
 * If an explicit override exists for (item, currency), use it. Otherwise
 * convert via billing_currencies.usd_rate and round UP to whole minor units.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ItemKind = "plan" | "pack" | "addon";

export type ResolvedPrice = {
  currency: string;
  amountMinor: number;
  usdAmountCents: number;
  source: "override" | "rate";
};

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
};

export async function resolvePrice(
  kind: ItemKind,
  itemCode: string,
  currency: string,
): Promise<ResolvedPrice> {
  const cur = currency.toUpperCase();

  // Look up the USD price.
  let usdCents: number;
  if (kind === "plan") {
    const { data } = await supabaseAdmin
      .from("billing_plans")
      .select("price_cents, is_active")
      .eq("code", itemCode)
      .maybeSingle();
    if (!data || !data.is_active) throw new Error(`Unknown plan: ${itemCode}`);
    usdCents = data.price_cents;
  } else if (kind === "pack") {
    const { data } = await supabaseAdmin
      .from("credit_packs")
      .select("price_cents, is_active")
      .eq("code", itemCode)
      .maybeSingle();
    if (!data || !data.is_active) throw new Error(`Unknown pack: ${itemCode}`);
    usdCents = data.price_cents;
  } else {
    const { data } = await supabaseAdmin
      .from("billing_addons")
      .select("price_cents, is_active")
      .eq("code", itemCode)
      .maybeSingle();
    if (!data || !data.is_active) throw new Error(`Unknown add-on: ${itemCode}`);
    usdCents = data.price_cents;
  }

  // Look up override.
  const { data: override } = await supabaseAdmin
    .from("billing_price_overrides")
    .select("amount_minor")
    .eq("item_kind", kind)
    .eq("item_code", itemCode)
    .eq("currency_code", cur)
    .maybeSingle();

  if (override) {
    return {
      currency: cur,
      amountMinor: Number(override.amount_minor),
      usdAmountCents: usdCents,
      source: "override",
    };
  }

  if (cur === "USD") {
    return { currency: "USD", amountMinor: usdCents, usdAmountCents: usdCents, source: "rate" };
  }

  // Convert via rate.
  const { data: cur_row } = await supabaseAdmin
    .from("billing_currencies")
    .select("usd_rate, is_active")
    .eq("code", cur)
    .maybeSingle();
  if (!cur_row || !cur_row.is_active) {
    throw new Error(`Currency not available: ${cur}`);
  }
  const rate = Number(cur_row.usd_rate);
  const decimals = CURRENCY_DECIMALS[cur] ?? 2;
  // usdCents * rate gives "minor units of target currency" only if both have 2 decimals.
  // We assume 2-decimal target currencies (NGN/GHS/KES/ZAR all use 2). For safety:
  const usdMajor = usdCents / 100;
  const localMajor = usdMajor * rate;
  const amountMinor = Math.ceil(localMajor * Math.pow(10, decimals));

  return { currency: cur, amountMinor, usdAmountCents: usdCents, source: "rate" };
}
