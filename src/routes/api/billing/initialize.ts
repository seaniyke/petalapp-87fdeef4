/**
 * POST /api/billing/initialize
 *
 * Starts a Paystack hosted-checkout transaction for either a plan or a
 * top-up pack, in the user's chosen currency.
 *
 * Body: { purpose: 'plan'|'pack', itemCode: string, currency: string }
 * Returns: { authorizationUrl, reference }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { initializeTransaction, getEnvironment } from "@/server/paystack.server";
import { resolvePrice } from "@/server/billing-pricing.server";

const SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;

const Body = z.object({
  purpose: z.enum(["plan", "pack"]),
  itemCode: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  currency: z.enum(SUPPORTED_CURRENCIES),
  returnUrl: z.string().url().max(500),
});

export const Route = createFileRoute("/api/billing/initialize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(
          auth.slice(7),
        );
        if (authErr || !userData.user?.email) {
          return new Response("Unauthorized", { status: 401 });
        }

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        try {
          const price = await resolvePrice(parsed.purpose, parsed.itemCode, parsed.currency);
          const reference = `pt_${crypto.randomUUID().replace(/-/g, "")}`;
          const env = getEnvironment();

          // Record the pending transaction first.
          const { error: insertErr } = await supabaseAdmin
            .from("paystack_transactions")
            .insert({
              user_id: userData.user.id,
              reference,
              purpose: parsed.purpose,
              item_code: parsed.itemCode,
              currency_code: parsed.currency,
              amount_minor: price.amountMinor,
              usd_amount_cents: price.usdAmountCents,
              status: "pending",
              environment: env,
            });
          if (insertErr) throw new Error(insertErr.message);

          const init = await initializeTransaction({
            email: userData.user.email,
            amountMinor: price.amountMinor,
            currency: parsed.currency,
            reference,
            callbackUrl: parsed.returnUrl,
            metadata: {
              user_id: userData.user.id,
              purpose: parsed.purpose,
              item_code: parsed.itemCode,
            },
          });

          // Remember preferred currency.
          await supabaseAdmin
            .from("user_wallets")
            .upsert(
              { user_id: userData.user.id, preferred_currency: parsed.currency },
              { onConflict: "user_id" },
            );

          return new Response(
            JSON.stringify({
              authorizationUrl: init.authorizationUrl,
              reference: init.reference,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("[paystack initialize] failed", err);
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Failed to start checkout",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
