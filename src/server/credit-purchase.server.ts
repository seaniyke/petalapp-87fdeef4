/**
 * Credit purchase rules shared by card (Paystack) and crypto checkout.
 *
 * - Minimum purchase: `min_purchase_usd_cents` (default 300 = $3.00),
 *   applied to every credit purchase, packs and custom amounts alike.
 * - Custom amounts: credits = USD cents / `credit_retail_usd_cents`.
 *   Always computed on the server; the client never sends a credit count.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValue } from "@/server/economics-config.server";

export const CUSTOM_PACK_CODE = "custom";

export async function minimumPurchaseUsdCents(): Promise<number> {
  const v = await economicsValue("min_purchase_usd_cents");
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 300;
}

/** Credits a custom purchase of `usdCents` buys, rounded down to 2 decimals. */
export async function creditsForUsdCents(usdCents: number): Promise<number> {
  const retail = await economicsValue("credit_retail_usd_cents");
  const perCredit = Number.isFinite(retail) && retail > 0 ? retail : 15;
  return Math.floor((usdCents / perCredit) * 100) / 100;
}

const SYMBOLS: Record<string, string> = { NGN: "₦", USD: "$", GHS: "₵", KES: "KSh", ZAR: "R" };

export async function belowMinimumMessage(currency: string): Promise<string> {
  const floor = await minimumPurchaseUsdCents();
  const cur = currency.toUpperCase();
  let label = `$${(floor / 100).toFixed(2)}`;
  if (cur !== "USD") {
    const { data } = await supabaseAdmin
      .from("billing_currencies")
      .select("usd_rate")
      .eq("code", cur)
      .maybeSingle();
    const rate = Number(data?.usd_rate ?? 0);
    if (rate > 0) {
      const local = Math.ceil((floor / 100) * rate);
      label = `${SYMBOLS[cur] ?? ""}${local.toLocaleString()} (${label})`;
    }
  }
  return `The smallest purchase is ${label}. Pick a larger amount to continue.`;
}
