/**
 * POST /api/billing/create-portal-session
 *
 * Returns a Stripe Billing Portal URL so the user can manage their
 * subscription, payment methods, and invoices. Opens in a new tab.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().url().max(500).optional(),
});

export const Route = createFileRoute("/api/billing/create-portal-session")({
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
        if (authErr || !userData.user) {
          return new Response("Unauthorized", { status: 401 });
        }

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", userData.user.id)
          .eq("environment", parsed.environment)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!sub?.stripe_customer_id) {
          return new Response(
            JSON.stringify({ error: "No subscription found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const stripe = createStripeClient(parsed.environment as StripeEnv);
          const portal = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            ...(parsed.returnUrl && { return_url: parsed.returnUrl }),
          });
          return new Response(JSON.stringify({ url: portal.url }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[create-portal-session] stripe error", err);
          return new Response(
            JSON.stringify({ error: "Portal session failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
