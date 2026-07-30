/**
 * Crypto checkout — pay for a plan, a credit pack or a Cloud + AI top-up by
 * sending crypto to one of Petal's public wallets.
 *
 * POST /api/billing/crypto  — record a submission (status: pending)
 * GET  /api/billing/crypto  — list the caller's own submissions
 *
 * No funds move through this endpoint. The USD value is resolved SERVER-side
 * from the same pricing tables card checkout uses, so a caller can't claim a
 * $99 plan for a $1 transfer. An admin confirms the transaction on-chain in
 * /admin/billing, which is what actually credits the wallet.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEnvironment } from "@/server/paystack.server";
import { resolvePrice } from "@/server/billing-pricing.server";
import { CRYPTO_WALLETS } from "@/lib/crypto-tips";

const Body = z.object({
  purpose: z.enum(["plan", "pack", "runtime_topup"]),
  itemCode: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  walletId: z.string().min(1).max(40),
  txHash: z.string().trim().min(6).max(200),
  amountSent: z.number().positive().max(1_000_000).optional(),
  /** Only for runtime_topup with a custom amount — USD cents. */
  customUsdCents: z.number().int().positive().max(10_000_00).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireUser(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user ?? null;
}

export const Route = createFileRoute("/api/billing/crypto")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const { data } = await supabaseAdmin
          .from("crypto_payments")
          .select(
            "id, reference, purpose, item_code, usd_amount_cents, asset, chain, tx_hash, amount_sent, status, admin_note, verify_note, confirmations, detected_usd_cents, last_checked_at, credited_at, created_at",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        return json({ payments: data ?? [] });
      },

      POST: async ({ request }) => {
        const user = await requireUser(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return json({ error: "Invalid submission." }, 400);
        }

        const wallet = CRYPTO_WALLETS.find(
          (w) => w.id === parsed.walletId && w.address.trim().length > 0,
        );
        if (!wallet) return json({ error: "Unknown wallet." }, 400);

        try {
          // Credit packs are pay-as-you-go: ANY signed-in user can buy one,
          // no subscription needed. Cloud + AI runtime top-ups still need
          // full access (subscription OR purchased credits remaining).
          if (parsed.purpose === "runtime_topup") {
            const { hasFullAccess } = await import("@/server/entitlements.server");
            if (!(await hasFullAccess(user.id))) {
              return json(
                {
                  error:
                    "Buy credits or upgrade to a paid plan to top up your Cloud + AI balance.",
                  code: "upgrade_required",
                },
                403,
              );
            }
          }


          // --- Server-side USD price resolution ---
          let usdAmountCents: number;
          if (parsed.purpose === "runtime_topup") {
            if (parsed.customUsdCents) {
              if (parsed.customUsdCents < 100) {
                return json({ error: "Minimum top-up is $1.00." }, 400);
              }
              usdAmountCents = parsed.customUsdCents;
            } else {
              const { data: pack } = await supabaseAdmin
                .from("runtime_topup_packs")
                .select("amount_cents, is_active")
                .eq("code", parsed.itemCode)
                .maybeSingle();
              if (!pack || !pack.is_active) {
                return json({ error: "Unknown top-up pack." }, 400);
              }
              usdAmountCents = Number(pack.amount_cents);
            }
          } else {
            const price = await resolvePrice(parsed.purpose, parsed.itemCode, "USD");
            usdAmountCents = price.usdAmountCents;
          }

          const reference = `crypto_${parsed.txHash.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48)}`;

          const { data: inserted, error } = await supabaseAdmin
            .from("crypto_payments")
            .insert({
              user_id: user.id,
              reference,
              purpose: parsed.purpose,
              item_code: parsed.itemCode,
              usd_amount_cents: usdAmountCents,
              asset: wallet.asset,
              chain: wallet.network,
              wallet_address: wallet.address,
              tx_hash: parsed.txHash.trim(),
              amount_sent: parsed.amountSent ?? null,
              environment: getEnvironment(),
            } as never)
            .select("id")
            .single();

          if (error) {
            if (error.code === "23505") {
              return json(
                { error: "We already have that transaction hash on file." },
                409,
              );
            }
            throw new Error(error.message);
          }

          return json({
            ok: true,
            id: (inserted as unknown as { id: string } | null)?.id ?? null,
            reference,
            usdAmountCents,
          });
        } catch (err) {
          console.error("[billing crypto] failed", err);
          return json({ error: "Could not record your payment. Try again." }, 500);
        }
      },
    },
  },
});
