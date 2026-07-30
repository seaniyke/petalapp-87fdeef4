/**
 * Background crypto verifier.
 *
 * Walks pending `crypto_payments`, looks each transaction hash up on its
 * chain's public explorer, and:
 *   - confirms + credits + emails a receipt when the transfer clears
 *   - records progress (confirmations, note) while it's still maturing
 *   - flags mismatches (wrong wallet, underpaid, failed tx) for admin review
 *   - gives up after ~48h of not finding the hash at all
 *
 * Users never have to refresh or re-submit — the checkout tracker and the
 * billing page both read the row this job updates.
 *
 * Auth: `x-petal-cron-secret` matching BUILDER_SHARED_SECRET.
 * Schedule: every 2–5 minutes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCryptoPayment } from "@/server/crypto-verify.server";
import { creditCryptoPayment, type CryptoPaymentRow } from "@/server/crypto-credit.server";

/** Stop polling a hash we've never seen after this many attempts (~48h at 5m). */
const MAX_ATTEMPTS = 576;
const BATCH = 25;

export async function runCryptoVerifier(origin: string): Promise<{
  checked: number;
  confirmed: number;
  pending: number;
  flagged: number;
  expired: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("crypto_payments" as never)
    .select("*")
    .eq("status", "pending")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<
    CryptoPaymentRow & {
      wallet_address: string;
      verify_attempts: number;
    }
  >;

  let confirmed = 0;
  let pending = 0;
  let flagged = 0;
  let expired = 0;

  for (const row of rows) {
    const attempts = Number(row.verify_attempts ?? 0) + 1;
    const outcome = await verifyCryptoPayment({
      id: row.id,
      asset: row.asset,
      chain: row.chain,
      wallet_address: row.wallet_address,
      tx_hash: row.tx_hash,
      usd_amount_cents: row.usd_amount_cents,
    });

    const base = {
      verify_attempts: attempts,
      last_checked_at: new Date().toISOString(),
      verify_note: outcome.note,
    } as Record<string, unknown>;

    if (outcome.kind === "confirmed") {
      await supabaseAdmin
        .from("crypto_payments" as never)
        .update({
          ...base,
          confirmations: outcome.confirmations,
          detected_usd_cents: outcome.detectedUsdCents,
        } as never)
        .eq("id", row.id);

      const res = await creditCryptoPayment({
        payment: row,
        origin,
        reviewedBy: null,
        note: outcome.note,
      });
      if (res.ok) confirmed += 1;
      else flagged += 1;
      continue;
    }

    if (outcome.kind === "pending") {
      await supabaseAdmin
        .from("crypto_payments" as never)
        .update({ ...base, confirmations: outcome.confirmations } as never)
        .eq("id", row.id);
      pending += 1;
      continue;
    }

    if (outcome.kind === "mismatch") {
      // Never auto-reject money: park it for a human, but tell the user why.
      await supabaseAdmin
        .from("crypto_payments" as never)
        .update({
          ...base,
          status: "needs_review",
          confirmations: outcome.confirmations ?? null,
          detected_usd_cents: outcome.detectedUsdCents ?? null,
        } as never)
        .eq("id", row.id);
      flagged += 1;
      continue;
    }

    // not_found
    if (attempts >= MAX_ATTEMPTS) {
      await supabaseAdmin
        .from("crypto_payments" as never)
        .update({
          ...base,
          status: "needs_review",
          verify_note: "We never found this transaction on-chain.",
        } as never)
        .eq("id", row.id);
      expired += 1;
    } else {
      await supabaseAdmin.from("crypto_payments" as never).update(base as never).eq("id", row.id);
      pending += 1;
    }
  }

  return { checked: rows.length, confirmed, pending, flagged, expired };
}

async function handle(request: Request) {
  const secret = process.env.BUILDER_SHARED_SECRET;
  const provided = request.headers.get("x-petal-cron-secret");
  if (!secret || provided !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await runCryptoVerifier(new URL(request.url).origin);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron crypto-verify] failed", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Verifier failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/crypto-verify")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
