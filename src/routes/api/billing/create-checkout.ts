/**
 * POST /api/billing/create-checkout
 *
 * Returns a Stripe embedded-checkout `client_secret` for the requested price.
 * The user must be authenticated — we attach their userId to subscription
 * metadata so the webhook can link the resulting subscription back.
 *
 * Tax: full compliance handling is enabled on every session
 * (`managed_payments: { enabled: true }`). For buyers in countries Stripe
 * doesn't manage end-to-end, Stripe still calculates and collects tax.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  priceId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().url().max(500),
});

async function getUserFromAuth(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export const Route = createFileRoute("/api/billing/create-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromAuth(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = Body.safeParse(body);
        if (!parsed.success) {
          return new Response("Invalid body", { status: 400 });
        }
        const { priceId, environment, returnUrl } = parsed.data;

        const stripe = createStripeClient(environment as StripeEnv);

        // Resolve our human-readable price id (the lookup_key set by
        // batch_create_product) to the actual Stripe price.
        const prices = await stripe.prices.list({ lookup_keys: [priceId], limit: 1 });
        const stripePrice = prices.data[0];
        if (!stripePrice) {
          return new Response("Price not found", { status: 404 });
        }
        const isRecurring = stripePrice.type === "recurring";

        try {
          const session = await stripe.checkout.sessions.create({
            line_items: [{ price: stripePrice.id, quantity: 1 }],
            mode: isRecurring ? "subscription" : "payment",
            ui_mode: "embedded",
            return_url: returnUrl,
            customer_email: user.email ?? undefined,
            metadata: {
              userId: user.id,
              priceId,
            },
            ...(isRecurring && {
              subscription_data: {
                metadata: { userId: user.id, priceId },
              },
            }),
            managed_payments: { enabled: true },
          });

          return new Response(
            JSON.stringify({ clientSecret: session.client_secret }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("[create-checkout] stripe error", err);
          const message = err instanceof Error ? err.message : "Checkout failed";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
