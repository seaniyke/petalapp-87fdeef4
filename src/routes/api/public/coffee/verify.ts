/**
 * GET /api/public/coffee/verify?reference=...
 *
 * Verifies a "Buy us a coffee" transaction with Paystack and marks the row
 * succeeded/failed. Idempotent — safe to call multiple times.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTransaction } from "@/server/paystack.server";

export const Route = createFileRoute("/api/public/coffee/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const reference = url.searchParams.get("reference") || "";
        if (!/^coffee_[a-f0-9]{16,64}$/.test(reference)) {
          return new Response("Bad reference", { status: 400 });
        }

        try {
          const tx = await verifyTransaction(reference);
          if (!tx) {
            return new Response(JSON.stringify({ status: "unknown" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          const status =
            tx.status === "success"
              ? "success"
              : tx.status === "failed" || tx.status === "abandoned"
                ? tx.status
                : "pending";

          await supabaseAdmin
            .from("coffee_tips")
            .update({
              status,
              paid_at: status === "success" ? tx.paid_at : null,
            } as never)
            .eq("reference", reference);

          return new Response(
            JSON.stringify({ status, amount: tx.amount, currency: tx.currency }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("[coffee verify] failed", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Verify failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
