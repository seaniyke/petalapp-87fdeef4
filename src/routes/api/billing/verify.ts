/**
 * GET /api/billing/verify?reference=...
 *
 * Confirms a transaction with Paystack and applies credits/plan if it
 * succeeded. Used by the return page so users see a result instantly even
 * if the webhook hasn't fired yet. Idempotent — safe to call repeatedly.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTransaction } from "@/server/paystack.server";

const Query = z.object({
  reference: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

export const Route = createFileRoute("/api/billing/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        let q: z.infer<typeof Query>;
        try {
          q = Query.parse({ reference: url.searchParams.get("reference") ?? "" });
        } catch {
          return new Response("Invalid reference", { status: 400 });
        }

        const { data: tx } = await supabaseAdmin
          .from("paystack_transactions")
          .select("*")
          .eq("reference", q.reference)
          .maybeSingle();
        if (!tx) return new Response("Not found", { status: 404 });
        if (tx.user_id !== userData.user.id) {
          return new Response("Forbidden", { status: 403 });
        }

        // Already done — return what we have.
        if (tx.status === "success") {
          return Response.json({ status: "success", purpose: tx.purpose, item_code: tx.item_code });
        }

        try {
          const data = await verifyTransaction(q.reference);
          if (!data) {
            return Response.json({ status: tx.status });
          }
          if (data.status === "success") {
            if (tx.purpose === "pack") {
              await supabaseAdmin.rpc("apply_paystack_topup", {
                _user_id: tx.user_id,
                _pack_code: tx.item_code,
                _reference: q.reference,
                _environment: tx.environment,
              });
            } else {
              await supabaseAdmin.rpc("apply_paystack_plan_grant", {
                _user_id: tx.user_id,
                _plan_code: tx.item_code,
                _reference: q.reference,
              });
            }
            await supabaseAdmin
              .from("paystack_transactions")
              .update({
                status: "success",
                paystack_reference: data.reference,
                channel: data.channel,
                paid_at: data.paid_at,
              })
              .eq("reference", q.reference);
            return Response.json({ status: "success", purpose: tx.purpose, item_code: tx.item_code });
          }
          if (data.status === "failed" || data.status === "abandoned") {
            await supabaseAdmin
              .from("paystack_transactions")
              .update({ status: data.status })
              .eq("reference", q.reference);
          }
          return Response.json({ status: data.status });
        } catch (err) {
          console.error("[paystack verify] failed", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Verify failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
