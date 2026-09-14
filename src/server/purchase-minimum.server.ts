/**
 * Minimum customer-facing purchase.
 *
 * The commercial baseline is ₦5,000. Every other currency derives from it
 * through the same `billing_currencies` rate table the rest of billing uses,
 * so the floor moves with the rate instead of being frozen into the code.
 *
 * This is a COMMERCIAL rule, not an internal cost assumption: it exists so a
 * purchase is worth the payment-processor fee and the support it carries.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValue } from "@/server/economics-config.server";

/** The floor expressed in USD cents, derived from the NGN baseline. */
export async function minimumPurchaseUsdCents(): Promise<number> {
  const ngnFloor = await economicsValue("min_purchase_ngn");
  const { data } = await supabaseAdmin
    .from("billing_currencies")
    .select("usd_rate")
    .eq("code", "NGN")
    .maybeSingle();
  const rate = Number(data?.usd_rate ?? 1600);
  if (!Number.isFinite(rate) || rate <= 0) return 313; // ₦5,000 at ₦1,600/$
  return Math.ceil((ngnFloor / rate) * 100);
}

/** The floor in a display currency's minor units, rounded to a clean figure. */
export async function minimumPurchaseMinor(currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  const ngnFloor = await economicsValue("min_purchase_ngn");
  if (cur === "NGN") return Math.round(ngnFloor * 100);
  const usdCents = await minimumPurchaseUsdCents();
  const { data } = await supabaseAdmin
    .from("billing_currencies")
    .select("usd_rate")
    .eq("code", cur)
    .maybeSingle();
  const rate = Number(data?.usd_rate ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) return usdCents;
  // Round up to a whole unit of the display currency so customers never see
  // an awkward fractional price.
  const major = Math.ceil((usdCents / 100) * rate);
  return major * 100;
}

export type MinimumCheck =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Gate a customer purchase against the floor. Applies to credit purchases and
 * balance top-ups — subscriptions and marketplace items are priced separately
 * and are not covered by this rule.
 */
export async function enforcePurchaseMinimum(args: {
  usdAmountCents: number;
  currency: string;
}): Promise<MinimumCheck> {
  const floorUsd = await minimumPurchaseUsdCents();
  if (args.usdAmountCents >= floorUsd) return { ok: true };
  const minor = await minimumPurchaseMinor(args.currency);
  const symbolByCode: Record<string, string> = {
    NGN: "₦",
    USD: "$",
    GHS: "₵",
    KES: "KSh",
    ZAR: "R",
  };
  const symbol = symbolByCode[args.currency.toUpperCase()] ?? "";
  const amount = (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return {
    ok: false,
    message: `The smallest purchase is ${symbol}${amount}. Pick a larger amount to continue.`,
  };
}
