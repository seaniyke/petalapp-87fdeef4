/**
 * GET /api/billing/subscription/status
 *
 * Returns whether the signed-in user has an active Paystack subscription so
 * the BillingSheet can show "Manage card" / "Cancel" controls.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/billing/subscription/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select(
            "provider, status, cancel_at_period_end, next_payment_date, paystack_subscription_code",
          )
          .eq("user_id", userData.user.id)
          .eq("provider" as never, "paystack")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const row = sub as {
          provider?: string;
          status?: string;
          cancel_at_period_end?: boolean;
          next_payment_date?: string | null;
          paystack_subscription_code?: string | null;
        } | null;

        return Response.json({
          hasPaystackSubscription: !!row?.paystack_subscription_code,
          status: row?.status ?? null,
          cancelAtPeriodEnd: !!row?.cancel_at_period_end,
          nextPaymentDate: row?.next_payment_date ?? null,
        });
      },
    },
  },
});
