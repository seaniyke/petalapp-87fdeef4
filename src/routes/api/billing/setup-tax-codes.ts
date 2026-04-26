/**
 * POST /api/billing/setup-tax-codes
 *
 * Idempotent admin-only setup that assigns tax codes to Stripe products.
 * Call once after creating products. Re-running has no effect.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyTaxCodes } from "@/server/stripe-tax-setup.server";
import type { StripeEnv } from "@/server/stripe.server";

export const Route = createFileRoute("/api/billing/setup-tax-codes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "admin",
        });
        if (!isAdmin) return new Response("Forbidden", { status: 403 });

        const url = new URL(request.url);
        const env = (url.searchParams.get("env") ?? "sandbox") as StripeEnv;
        if (env !== "sandbox" && env !== "live") {
          return new Response("Invalid env", { status: 400 });
        }

        try {
          await applyTaxCodes(env);
          return new Response(JSON.stringify({ ok: true, env }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[setup-tax-codes] failed", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
