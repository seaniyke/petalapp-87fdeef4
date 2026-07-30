/**
 * Credits a crypto payment and sends the receipt.
 *
 * Shared by the admin review action (manual confirm) and the background
 * verifier cron (automatic confirm) so both paths behave identically:
 *   1. atomically claim the row (pending → confirmed) to stop double-crediting
 *   2. apply the SAME wallet RPCs the card flow uses
 *   3. roll the claim back if crediting fails, so it can be retried
 *   4. stamp credited_at and fire the receipt email exactly once
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendBillingEmail } from "@/server/billing-email.server";

export type CryptoPaymentRow = {
  id: string;
  user_id: string;
  reference: string;
  purpose: string;
  item_code: string;
  usd_amount_cents: number;
  status: string;
  environment: string;
  asset: string;
  chain: string;
  tx_hash: string;
  created_at: string;
  credited_at?: string | null;
  receipt_email_sent_at?: string | null;
};

/** Human label + credit summary for an item, used in receipts. */
export async function describeCryptoItem(
  purpose: string,
  itemCode: string,
  usdAmountCents: number,
): Promise<{ label: string; creditsLabel: string | null }> {
  if (purpose === "plan") {
    const { data } = await supabaseAdmin
      .from("billing_plans")
      .select("name, monthly_credits")
      .eq("code", itemCode)
      .maybeSingle();
    return {
      label: data?.name ? `${data.name} plan` : `${itemCode} plan`,
      creditsLabel: data?.monthly_credits
        ? `${Number(data.monthly_credits).toLocaleString()} credits / month`
        : null,
    };
  }
  if (purpose === "pack") {
    const { data } = await supabaseAdmin
      .from("credit_packs")
      .select("name, credits")
      .eq("code", itemCode)
      .maybeSingle();
    return {
      label: data?.name ?? `${itemCode} credit pack`,
      creditsLabel: data?.credits ? `${Number(data.credits).toLocaleString()} credits` : null,
    };
  }
  return {
    label: `$${(usdAmountCents / 100).toFixed(2)} Cloud + AI top-up`,
    creditsLabel: `$${(usdAmountCents / 100).toFixed(2)} runtime balance`,
  };
}

export type CreditResult =
  | { ok: true; alreadyDone?: boolean }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Confirm + credit a pending crypto payment. Safe to call concurrently —
 * only the caller that wins the conditional update does the crediting.
 */
export async function creditCryptoPayment(args: {
  payment: CryptoPaymentRow;
  /** Origin used to call back into our own transactional email route. */
  origin: string;
  /** Admin user id when a human confirmed it; null for the auto-verifier. */
  reviewedBy?: string | null;
  note?: string | null;
}): Promise<CreditResult> {
  const { payment, origin } = args;

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("crypto_payments" as never)
    .update({
      status: "confirmed",
      admin_note: args.note ?? null,
      reviewed_by: args.reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id", payment.id)
    .eq("status", "pending")
    .select("id");
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed?.length) return { ok: false, error: "Already reviewed", conflict: true };

  try {
    if (payment.purpose === "pack") {
      const { error } = await supabaseAdmin.rpc("apply_paystack_topup", {
        _user_id: payment.user_id,
        _pack_code: payment.item_code,
        _reference: payment.reference,
        _environment: payment.environment,
      });
      if (error) throw new Error(error.message);
    } else if (payment.purpose === "plan") {
      const { error } = await supabaseAdmin.rpc("apply_paystack_plan_grant", {
        _user_id: payment.user_id,
        _plan_code: payment.item_code,
        _reference: payment.reference,
      });
      if (error) throw new Error(error.message);
    } else if (payment.purpose === "runtime_topup") {
      const { error } = await supabaseAdmin.rpc("apply_paystack_runtime_topup", {
        _user_id: payment.user_id,
        _reference: payment.reference,
        _amount_cents: payment.usd_amount_cents as never,
        _metadata: {
          method: "crypto",
          item_code: payment.item_code,
          environment: payment.environment,
        } as never,
      });
      if (error) throw new Error(error.message);
    } else {
      throw new Error(`Unknown purpose ${payment.purpose}`);
    }
  } catch (e) {
    await supabaseAdmin
      .from("crypto_payments" as never)
      .update({
        status: "pending",
        admin_note: `Credit failed: ${e instanceof Error ? e.message : "unknown"}`,
      } as never)
      .eq("id", payment.id);
    return { ok: false, error: e instanceof Error ? e.message : "Credit failed" };
  }

  const creditedAt = new Date().toISOString();
  await supabaseAdmin
    .from("crypto_payments" as never)
    .update({ credited_at: creditedAt } as never)
    .eq("id", payment.id);

  // Receipt — fire and forget, never blocks or fails the credit.
  try {
    const item = await describeCryptoItem(
      payment.purpose,
      payment.item_code,
      payment.usd_amount_cents,
    );
    await sendBillingEmail({
      origin,
      templateName: "crypto-payment-confirmed",
      idempotencyKey: `crypto-confirmed-${payment.id}`,
      userId: payment.user_id,
      templateData: {
        purpose: payment.purpose,
        itemLabel: item.label,
        creditsLabel: item.creditsLabel,
        amountDisplay: `$${(payment.usd_amount_cents / 100).toFixed(2)}`,
        asset: payment.asset,
        chain: payment.chain,
        txHash: payment.tx_hash,
        reference: payment.reference,
        submittedAt: payment.created_at,
        confirmedAt: creditedAt,
      },
    });
    await supabaseAdmin
      .from("crypto_payments" as never)
      .update({ receipt_email_sent_at: new Date().toISOString() } as never)
      .eq("id", payment.id);
  } catch (e) {
    console.warn("[crypto-credit] receipt email failed", e);
  }

  return { ok: true };
}
