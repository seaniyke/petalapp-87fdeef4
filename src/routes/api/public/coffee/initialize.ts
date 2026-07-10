/**
 * POST /api/public/coffee/initialize
 *
 * Public "Buy us a coffee" checkout. Anyone (signed in or not) can tip Petal
 * a small amount via Paystack. Kept OFF the paystack_transactions table so
 * the existing webhook / wallet flow is not affected — tips write to their
 * own `coffee_tips` table and are confirmed via /api/public/coffee/verify.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { initializeTransaction, getEnvironment } from "@/server/paystack.server";

const SUPPORTED = ["USD", "NGN", "GHS", "KES", "ZAR"] as const;

const Body = z.object({
  amountMinor: z.number().int().positive().max(50_000_00), // cap 50k units
  currency: z.enum(SUPPORTED),
  email: z.string().trim().email().max(255),
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().max(280).optional(),
  returnUrl: z.string().url().max(500),
});

export const Route = createFileRoute("/api/public/coffee/initialize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        // Enforce a $1 USD (or equivalent minor floor) minimum so Paystack fees don't
        // eat the whole tip. Keep it simple: use a small per-currency floor.
        const FLOOR: Record<string, number> = {
          USD: 100, NGN: 300_00, GHS: 10_00, KES: 100_00, ZAR: 20_00,
        };
        if (parsed.amountMinor < (FLOOR[parsed.currency] ?? 100)) {
          return new Response(
            JSON.stringify({ error: "Minimum tip is about $1 USD equivalent." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const reference = `coffee_${crypto.randomUUID().replace(/-/g, "")}`;
          const env = getEnvironment();

          const { error: insertErr } = await supabaseAdmin
            .from("coffee_tips")
            .insert({
              reference,
              supporter_email: parsed.email,
              supporter_name: parsed.name ?? null,
              message: parsed.message ?? null,
              amount_minor: parsed.amountMinor,
              currency_code: parsed.currency,
              status: "pending",
              environment: env,
            } as never);
          if (insertErr) throw new Error(insertErr.message);

          const init = await initializeTransaction({
            email: parsed.email,
            amountMinor: parsed.amountMinor,
            currency: parsed.currency,
            reference,
            callbackUrl: parsed.returnUrl,
            metadata: {
              kind: "coffee_tip",
              name: parsed.name ?? null,
              message: parsed.message ?? null,
            },
          });

          return new Response(
            JSON.stringify({
              authorizationUrl: init.authorizationUrl,
              reference: init.reference,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("[coffee initialize] failed", err);
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Could not start checkout",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
