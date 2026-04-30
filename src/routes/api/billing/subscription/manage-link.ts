/**
 * POST /api/billing/subscription/manage-link
 *
 * Returns a Paystack hosted page where the signed-in user can swap the card
 * on their active subscription (or cancel it). The link is short-lived and
 * specific to the user's subscription_code.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionManageLink } from "@/server/paystack.server";

export const Route = createFileRoute("/api/billing/subscription/manage-link")({
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
          .select("paystack_subscription_code, status")
          .eq("user_id", userData.user.id)
          .eq("provider" as never, "paystack")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const subCode = (sub as { paystack_subscription_code?: string } | null)
          ?.paystack_subscription_code;
        if (!subCode) {
          return new Response(
            JSON.stringify({ error: "No active Paystack subscription on this account." }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const link = await getSubscriptionManageLink(subCode);
          return Response.json({ link });
        } catch (err) {
          console.error("[subscription manage-link] failed", err);
          return new Response(
            JSON.stringify({ error: "Could not get manage link." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
