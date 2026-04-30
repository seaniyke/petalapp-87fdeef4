/**
 * POST /api/billing/subscription/cancel
 *
 * Marks the user's Paystack subscription as cancelled. Paystack stops billing
 * after the current period; the `subscription.disable` webhook completes the
 * downgrade locally when next_payment_date arrives.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { disableSubscription } from "@/server/paystack.server";

export const Route = createFileRoute("/api/billing/subscription/cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("paystack_subscription_code, paystack_email_token")
          .eq("user_id", userData.user.id)
          .eq("provider" as never, "paystack")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const row = sub as
          | { paystack_subscription_code?: string; paystack_email_token?: string }
          | null;
        if (!row?.paystack_subscription_code || !row.paystack_email_token) {
          return new Response(
            JSON.stringify({ error: "No active Paystack subscription on this account." }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          await disableSubscription(row.paystack_subscription_code, row.paystack_email_token);
          // Optimistic local flag — webhook will finalise.
          await supabaseAdmin
            .from("subscriptions")
            .update({
              cancel_at_period_end: true,
              updated_at: new Date().toISOString(),
            } as never)
            .eq("paystack_subscription_code", row.paystack_subscription_code);

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[subscription cancel] failed", err);
          return new Response(
            JSON.stringify({ error: "Could not cancel subscription." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
