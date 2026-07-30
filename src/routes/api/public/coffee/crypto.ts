/**
 * POST /api/public/coffee/crypto
 *
 * Records a crypto coffee tip. Anyone can submit the transaction hash after
 * sending to one of Petal's public wallets; the row lands in `coffee_tips`
 * with method = "crypto" and status = "pending" so an admin can confirm it
 * on-chain. No funds move through this endpoint.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEnvironment } from "@/server/paystack.server";

const Body = z.object({
  asset: z.string().trim().min(1).max(20),
  chain: z.string().trim().min(1).max(60),
  walletAddress: z.string().trim().min(4).max(120),
  amount: z.number().positive().max(1_000_000),
  txHash: z.string().trim().min(6).max(200),
  email: z.string().trim().email().max(255),
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().max(280).optional(),
});

export const Route = createFileRoute("/api/public/coffee/crypto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid submission." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const reference = `coffee_crypto_${parsed.txHash.slice(0, 40)}`;
          const { error } = await supabaseAdmin.from("coffee_tips").upsert(
            {
              reference,
              supporter_email: parsed.email,
              supporter_name: parsed.name ?? null,
              message: parsed.message ?? null,
              // Crypto amounts are stored in "minor" units of the asset itself
              // (2dp) so the admin table can render one consistent number.
              amount_minor: Math.round(parsed.amount * 100),
              currency_code: parsed.asset.toUpperCase(),
              status: "pending",
              method: "crypto",
              chain: parsed.chain,
              wallet_address: parsed.walletAddress,
              tx_hash: parsed.txHash,
              environment: getEnvironment(),
            } as never,
            { onConflict: "reference" },
          );
          if (error) throw new Error(error.message);

          return new Response(JSON.stringify({ ok: true, reference }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[coffee crypto] failed", err);
          return new Response(
            JSON.stringify({ error: "Could not record your tip. Try again." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
