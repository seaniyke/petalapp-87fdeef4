/**
 * On-demand on-chain check for the caller's own crypto payment.
 *
 * The background cron does the heavy lifting, but the checkout tracker calls
 * this while the user is watching so the status flips within seconds instead
 * of waiting for the next cron tick.
 *
 * POST /api/billing/crypto/check { paymentId }
 * Throttled to one explorer lookup per payment per 15s.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCryptoPayment } from "@/server/crypto-verify.server";
import { creditCryptoPayment, type CryptoPaymentRow } from "@/server/crypto-credit.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THROTTLE_MS = 15_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/billing/crypto/check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        const user = userData.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => ({}))) as { paymentId?: string };
        const id = String(body.paymentId ?? "");
        if (!UUID_RE.test(id)) return json({ error: "Invalid paymentId" }, 400);

        const { data: raw } = await supabaseAdmin
          .from("crypto_payments" as never)
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!raw) return json({ error: "Not found" }, 404);

        const row = raw as unknown as CryptoPaymentRow & {
          wallet_address: string;
          last_checked_at: string | null;
          verify_attempts: number;
          confirmations: number | null;
          verify_note: string | null;
        };

        if (row.status !== "pending") {
          return json({ payment: row, rechecked: false });
        }

        const last = row.last_checked_at ? Date.parse(row.last_checked_at) : 0;
        if (Date.now() - last < THROTTLE_MS) {
          return json({ payment: row, rechecked: false });
        }

        const outcome = await verifyCryptoPayment({
          id: row.id,
          asset: row.asset,
          chain: row.chain,
          wallet_address: row.wallet_address,
          tx_hash: row.tx_hash,
          usd_amount_cents: row.usd_amount_cents,
        });

        const patch: Record<string, unknown> = {
          verify_attempts: Number(row.verify_attempts ?? 0) + 1,
          last_checked_at: new Date().toISOString(),
          verify_note: outcome.note,
        };
        if (outcome.kind === "pending" || outcome.kind === "confirmed") {
          patch.confirmations = outcome.confirmations;
        }
        if (outcome.kind === "confirmed") patch.detected_usd_cents = outcome.detectedUsdCents;
        if (outcome.kind === "mismatch") {
          patch.status = "needs_review";
          if (outcome.detectedUsdCents != null) patch.detected_usd_cents = outcome.detectedUsdCents;
        }

        await supabaseAdmin
          .from("crypto_payments" as never)
          .update(patch as never)
          .eq("id", id);

        if (outcome.kind === "confirmed") {
          await creditCryptoPayment({
            payment: row,
            origin: new URL(request.url).origin,
            reviewedBy: null,
            note: outcome.note,
          });
        }

        const { data: fresh } = await supabaseAdmin
          .from("crypto_payments" as never)
          .select("*")
          .eq("id", id)
          .maybeSingle();

        return json({ payment: fresh ?? { ...row, ...patch }, rechecked: true });
      },
    },
  },
});
