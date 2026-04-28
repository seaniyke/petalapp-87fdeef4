/**
 * POST /api/public/paystack/webhook
 *
 * Receives Paystack webhook events. Verifies the HMAC-SHA512 signature
 * before doing anything. On charge.success, credits the user via the
 * apply_paystack_topup / apply_paystack_plan_grant RPCs.
 *
 * Idempotent: every event id is recorded in paystack_events.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyWebhookSignature } from "@/server/paystack.server";
import { provisionForProject } from "@/server/managed-backend.server";
import { registerDomain } from "@/server/cloudflare-registrar.server";
import { createCustomHostname } from "@/server/cloudflare-saas.server";

const MANAGED_BACKEND_ADDON = "managed_backend_monthly";

type ChargeEvent = {
  event: string;
  data?: {
    id?: number | string;
    reference?: string;
    status?: string;
    channel?: string | null;
    paid_at?: string | null;
    metadata?: Record<string, unknown> | string | null;
  };
};

export const Route = createFileRoute("/api/public/paystack/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const sig = request.headers.get("x-paystack-signature");
        const ok = await verifyWebhookSignature(rawBody, sig).catch(() => false);
        if (!ok) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: ChargeEvent;
        try {
          payload = JSON.parse(rawBody) as ChargeEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const ref = payload.data?.reference;
        const eventId = String(payload.data?.id ?? ref ?? "");
        if (!ref || !eventId) {
          return new Response("ok", { status: 200 });
        }

        // Idempotency.
        const { data: prior } = await supabaseAdmin
          .from("paystack_events")
          .select("id")
          .eq("id", eventId)
          .maybeSingle();
        if (prior) return new Response("ok", { status: 200 });

        await supabaseAdmin.from("paystack_events").insert([
          {
            id: eventId,
            type: payload.event,
            payload: JSON.parse(rawBody),
          },
        ]);

        if (payload.event !== "charge.success" || payload.data?.status !== "success") {
          // Record failure states on the transaction, but don't grant.
          if (payload.event === "charge.failed") {
            await supabaseAdmin
              .from("paystack_transactions")
              .update({ status: "failed" })
              .eq("reference", ref);
          }
          return new Response("ok", { status: 200 });
        }

        const { data: tx } = await supabaseAdmin
          .from("paystack_transactions")
          .select("*")
          .eq("reference", ref)
          .maybeSingle();
        if (!tx) {
          // Unknown reference — log and exit.
          console.warn("[paystack webhook] unknown reference", ref);
          return new Response("ok", { status: 200 });
        }

        try {
          if (tx.purpose === "pack") {
            await supabaseAdmin.rpc("apply_paystack_topup", {
              _user_id: tx.user_id,
              _pack_code: tx.item_code,
              _reference: ref,
              _environment: tx.environment,
            });
          } else if (tx.purpose === "runtime_topup") {
            await supabaseAdmin.rpc("apply_paystack_runtime_topup", {
              _user_id: tx.user_id,
              _reference: ref,
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
            if (tx.item_code === MANAGED_BACKEND_ADDON) {
              await supabaseAdmin.rpc("apply_paystack_backend_slot", {
                _user_id: tx.user_id,
                _project_id: tx.project_id,
                _addon_code: tx.item_code,
                _reference: ref,
                _amount_minor: tx.amount_minor,
                _currency_code: tx.currency_code,
                _environment: tx.environment,
              });
              provisionForProject(tx.project_id).catch((e) =>
                console.error("[webhook] provisionForProject failed", e),
              );
            } else {
              await supabaseAdmin.rpc("apply_paystack_domain_slot", {
                _user_id: tx.user_id,
                _project_id: tx.project_id,
                _addon_code: tx.item_code,
                _reference: ref,
                _amount_minor: tx.amount_minor,
                _currency_code: tx.currency_code,
                _environment: tx.environment,
              });
            }
          } else if (tx.purpose === "domain_purchase") {
            if (!tx.project_id) {
              throw new Error("Domain purchase missing project_id");
            }
            // Fire-and-forget the actual registration so we ack the webhook
            // quickly. The handler updates `purchased_domains.status` itself.
            handleDomainPurchase({
              reference: ref,
              projectId: tx.project_id,
              userId: tx.user_id,
            }).catch((e) =>
              console.error("[webhook] domain_purchase failed", e),
            );
          } else {
            await supabaseAdmin.rpc("apply_paystack_plan_grant", {
              _user_id: tx.user_id,
              _plan_code: tx.item_code,
              _reference: ref,
            });
          }
          await supabaseAdmin
            .from("paystack_transactions")
            .update({
              status: "success",
              paystack_reference: ref,
              channel: payload.data?.channel ?? null,
              paid_at: payload.data?.paid_at ?? null,
            })
            .eq("reference", ref);
        } catch (err) {
          console.error("[paystack webhook] grant failed", err);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
