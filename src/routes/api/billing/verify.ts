/**
 * GET /api/billing/verify?reference=...
 *
 * Confirms a transaction with Paystack and applies credits/plan if it
 * succeeded. Used by the return page so users see a result instantly even
 * if the webhook hasn't fired yet. Idempotent — safe to call repeatedly.
 *
 * Security:
 *   - Requires the caller to be the user that owns the tx.
 *   - Re-asserts amount, currency, and environment against Paystack's
 *     authoritative response before granting anything.
 *   - Conditional UPDATE on status='pending' so concurrent webhook + return
 *     callers can't double-write the row.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTransaction, getEnvironment } from "@/server/paystack.server";
import {
  sendBillingEmail,
  billingItemLabel,
  formatMinorAmount,
} from "@/server/billing-email.server";
import { startDomainRegistration } from "@/server/domain-purchase.server";

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
          if (tx.purpose === "domain_purchase") {
            await startDomainRegistration({ reference: q.reference });
          }
          return Response.json({
            status: "success",
            purpose: tx.purpose,
            item_code: tx.item_code,
          });
        }
        if (tx.status === "failed" || tx.status === "abandoned") {
          return Response.json({ status: tx.status });
        }

        try {
          const data = await verifyTransaction(q.reference);
          if (!data) {
            return Response.json({ status: tx.status });
          }

          if (data.status === "success") {
            // --- Authoritative cross-checks before granting anything ---
            const currentEnv = getEnvironment();
            if (tx.environment !== currentEnv) {
              console.error(
                "[paystack verify] env mismatch",
                { ref: q.reference, txEnv: tx.environment, currentEnv },
              );
              await supabaseAdmin
                .from("paystack_transactions")
                .update({ status: "failed" })
                .eq("reference", q.reference)
                .eq("status", "pending");
              return new Response(
                JSON.stringify({ error: "Environment mismatch — payment rejected." }),
                { status: 400, headers: { "Content-Type": "application/json" } },
              );
            }
            if (
              Number(data.amount) !== Number(tx.amount_minor) ||
              String(data.currency).toUpperCase() !==
                String(tx.currency_code).toUpperCase()
            ) {
              console.error("[paystack verify] amount/currency mismatch", {
                ref: q.reference,
                expected: { amt: tx.amount_minor, cur: tx.currency_code },
                got: { amt: data.amount, cur: data.currency },
              });
              await supabaseAdmin
                .from("paystack_transactions")
                .update({ status: "failed" })
                .eq("reference", q.reference)
                .eq("status", "pending");
              return new Response(
                JSON.stringify({ error: "Payment details mismatch — rejected." }),
                { status: 400, headers: { "Content-Type": "application/json" } },
              );
            }

            if (tx.purpose === "pack") {
              await supabaseAdmin.rpc("apply_paystack_topup", {
                _user_id: tx.user_id,
                _pack_code: tx.item_code,
                _reference: q.reference,
                _environment: tx.environment,
              });
            } else if (tx.purpose === "runtime_topup") {
              await supabaseAdmin.rpc("apply_paystack_runtime_topup", {
                _user_id: tx.user_id,
                _reference: q.reference,
                _amount_cents: tx.usd_amount_cents as never,
                _metadata: {
                  item_code: tx.item_code,
                  currency_code: tx.currency_code,
                  amount_minor: tx.amount_minor,
                  environment: tx.environment,
                } as never,
              });
            } else if (tx.purpose === "addon") {
              if (!tx.project_id) {
                throw new Error("Add-on transaction missing project_id");
              }
              await supabaseAdmin.rpc("apply_paystack_domain_slot", {
                _user_id: tx.user_id,
                _project_id: tx.project_id,
                _addon_code: tx.item_code,
                _reference: q.reference,
                _amount_minor: tx.amount_minor,
                _currency_code: tx.currency_code,
                _environment: tx.environment,
              });
            } else if (tx.purpose === "domain_purchase") {
              await startDomainRegistration({ reference: q.reference });
            } else if (tx.purpose === "plan") {
              await supabaseAdmin.rpc("apply_paystack_plan_grant", {
                _user_id: tx.user_id,
                _plan_code: tx.item_code,
                _reference: q.reference,
              });
            } else {
              console.error("[paystack verify] unknown purpose", tx.purpose);
              return new Response(
                JSON.stringify({ error: "Unknown transaction purpose" }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }

            // Conditional update so a concurrent webhook can't race us.
            await supabaseAdmin
              .from("paystack_transactions")
              .update({
                status: "success",
                paystack_reference: data.reference,
                channel: data.channel,
                paid_at: data.paid_at,
              })
              .eq("reference", q.reference)
              .eq("status", "pending");

            // Send branded receipt — fire-and-forget. Idempotency key is
            // the reference, so a verify+webhook race only sends one email.
            void sendBillingEmail({
              origin: new URL(request.url).origin,
              templateName: "payment-success",
              idempotencyKey: `billing-success-${q.reference}`,
              userId: tx.user_id,
              templateData: {
                purpose: tx.purpose,
                itemLabel: billingItemLabel({
                  purpose: tx.purpose,
                  itemCode: tx.item_code,
                  usdAmountCents: tx.usd_amount_cents,
                }),
                amountDisplay: formatMinorAmount(
                  Number(tx.amount_minor),
                  String(tx.currency_code),
                ),
                reference: q.reference,
                paidAt: data.paid_at ?? new Date().toISOString(),
              },
            });

            return Response.json({
              status: "success",
              purpose: tx.purpose,
              item_code: tx.item_code,
            });
          }
          if (data.status === "failed" || data.status === "abandoned") {
            await supabaseAdmin
              .from("paystack_transactions")
              .update({ status: data.status })
              .eq("reference", q.reference)
              .eq("status", "pending");

            void sendBillingEmail({
              origin: new URL(request.url).origin,
              templateName: "payment-failed",
              idempotencyKey: `billing-failed-${q.reference}`,
              userId: tx.user_id,
              templateData: {
                itemLabel: billingItemLabel({
                  purpose: tx.purpose,
                  itemCode: tx.item_code,
                  usdAmountCents: tx.usd_amount_cents,
                }),
                amountDisplay: formatMinorAmount(
                  Number(tx.amount_minor),
                  String(tx.currency_code),
                ),
                reference: q.reference,
                reason: data.status,
              },
            });
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
