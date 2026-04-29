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
import { verifyWebhookSignature, getEnvironment } from "@/server/paystack.server";
import { startDomainRegistration } from "@/server/domain-purchase.server";
import {
  sendBillingEmail,
  billingItemLabel,
  formatMinorAmount,
} from "@/server/billing-email.server";

type ChargeEvent = {
  event: string;
  data?: {
    id?: number | string;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    channel?: string | null;
    paid_at?: string | null;
    metadata?: Record<string, unknown> | string | null;
  };
};

// Events we know how to handle. Anything else is logged + acked so Paystack
// doesn't retry, but we never blindly trust unknown event types.
const KNOWN_EVENTS = new Set([
  "charge.success",
  "charge.failed",
  "charge.abandoned",
]);

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
        // Idempotency must key off the Paystack event id, NOT the reference,
        // so multiple legitimate events for the same charge (success after a
        // failed attempt, etc.) aren't dropped. If id is missing we ack but
        // do nothing — better to skip than to corrupt state.
        const eventId = payload.data?.id != null ? String(payload.data.id) : null;
        if (!ref || !eventId) {
          console.warn("[paystack webhook] missing reference or event id", { ref, eventId });
          return new Response("ok", { status: 200 });
        }

        if (!KNOWN_EVENTS.has(payload.event)) {
          console.warn("[paystack webhook] unknown event type", payload.event);
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
          // Record terminal failure states on the transaction, but don't grant.
          const reason: "failed" | "abandoned" | null =
            payload.event === "charge.failed"
              ? "failed"
              : payload.event === "charge.abandoned"
                ? "abandoned"
                : null;
          if (reason) {
            await supabaseAdmin
              .from("paystack_transactions")
              .update({ status: reason })
              .eq("reference", ref)
              .eq("status", "pending");

            const { data: failedTx } = await supabaseAdmin
              .from("paystack_transactions")
              .select("user_id, purpose, item_code, amount_minor, currency_code, usd_amount_cents")
              .eq("reference", ref)
              .maybeSingle();
            if (failedTx?.user_id) {
              void sendBillingEmail({
                origin: new URL(request.url).origin,
                templateName: "payment-failed",
                idempotencyKey: `billing-failed-${ref}`,
                userId: failedTx.user_id,
                templateData: {
                  itemLabel: billingItemLabel({
                    purpose: failedTx.purpose,
                    itemCode: failedTx.item_code,
                    usdAmountCents: failedTx.usd_amount_cents,
                  }),
                  amountDisplay: formatMinorAmount(
                    Number(failedTx.amount_minor),
                    String(failedTx.currency_code),
                  ),
                  reference: ref,
                  reason,
                },
              });
            }
          }
          return new Response("ok", { status: 200 });
        }


        const { data: tx } = await supabaseAdmin
          .from("paystack_transactions")
          .select("*")
          .eq("reference", ref)
          .maybeSingle();
        if (!tx) {
          // Unknown reference — log and exit. Don't 500; nothing we can do.
          console.warn("[paystack webhook] unknown reference", ref);
          return new Response("ok", { status: 200 });
        }

        // Already granted. Defense-in-depth on top of RPC-level idempotency.
        if (tx.status === "success") {
          return new Response("ok", { status: 200 });
        }
        if (tx.status !== "pending") {
          // failed / abandoned — don't resurrect.
          console.warn("[paystack webhook] tx in terminal state", { ref, status: tx.status });
          return new Response("ok", { status: 200 });
        }

        // Authoritative amount / currency / environment cross-check.
        const currentEnv = getEnvironment();
        if (tx.environment !== currentEnv) {
          console.error("[paystack webhook] env mismatch", {
            ref,
            txEnv: tx.environment,
            currentEnv,
          });
          await supabaseAdmin
            .from("paystack_transactions")
            .update({ status: "failed" })
            .eq("reference", ref)
            .eq("status", "pending");
          return new Response("ok", { status: 200 });
        }
        if (
          payload.data?.amount != null &&
          Number(payload.data.amount) !== Number(tx.amount_minor)
        ) {
          console.error("[paystack webhook] amount mismatch", {
            ref,
            expected: tx.amount_minor,
            got: payload.data.amount,
          });
          await supabaseAdmin
            .from("paystack_transactions")
            .update({ status: "failed" })
            .eq("reference", ref)
            .eq("status", "pending");
          return new Response("ok", { status: 200 });
        }
        if (
          payload.data?.currency &&
          String(payload.data.currency).toUpperCase() !==
            String(tx.currency_code).toUpperCase()
        ) {
          console.error("[paystack webhook] currency mismatch", {
            ref,
            expected: tx.currency_code,
            got: payload.data.currency,
          });
          await supabaseAdmin
            .from("paystack_transactions")
            .update({ status: "failed" })
            .eq("reference", ref)
            .eq("status", "pending");
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
            await supabaseAdmin.rpc("apply_paystack_domain_slot", {
              _user_id: tx.user_id,
              _project_id: tx.project_id,
              _addon_code: tx.item_code,
              _reference: ref,
              _amount_minor: tx.amount_minor,
              _currency_code: tx.currency_code,
              _environment: tx.environment,
            });
          } else if (tx.purpose === "domain_purchase") {
            if (!tx.project_id) {
              throw new Error("Domain purchase missing project_id");
            }
            // Fire-and-forget — kick off Cloudflare's async registration
            // workflow. Polling continues from /api/registrar/poll (and
            // any future cron). We ack the webhook quickly either way.
            startDomainRegistration({ reference: ref }).catch((e) =>
              console.error("[webhook] domain_purchase failed", e),
            );
          } else if (tx.purpose === "plan") {
            await supabaseAdmin.rpc("apply_paystack_plan_grant", {
              _user_id: tx.user_id,
              _plan_code: tx.item_code,
              _reference: ref,
            });
          } else {
            console.error("[paystack webhook] unknown purpose", tx.purpose);
            // Return 500 so Paystack retries — gives us time to deploy a fix.
            return new Response("Unknown purpose", { status: 500 });
          }
          await supabaseAdmin
            .from("paystack_transactions")
            .update({
              status: "success",
              paystack_reference: ref,
              channel: payload.data?.channel ?? null,
              paid_at: payload.data?.paid_at ?? null,
            })
            .eq("reference", ref)
            .eq("status", "pending");

          // Branded receipt — fire-and-forget. Same idempotency key as
          // the verify route so a verify+webhook race only sends one.
          void sendBillingEmail({
            origin: new URL(request.url).origin,
            templateName: "payment-success",
            idempotencyKey: `billing-success-${ref}`,
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
              reference: ref,
              paidAt: payload.data?.paid_at ?? new Date().toISOString(),
            },
          });

        } catch (err) {
          console.error("[paystack webhook] grant failed", err);
          // Return 500 so Paystack retries with backoff — better than
          // silently losing a real charge.
          return new Response("Grant failed", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

/**
 * Background job kicked off when a domain_purchase Paystack charge succeeds.
 *
 * 1. Mark the purchase row as "registering".
 * 2. Call Cloudflare Registrar to actually register the domain.
 * 3. On success: register the hostname as a custom hostname on our SaaS zone
 *    so the project starts serving traffic, then link it back via
 *    `connected_domain_id`.
 * 4. On failure: store the error so the UI can show it; the user keeps the
 *    pending charge for support follow-up.
 *
 * We deliberately do NOT throw out of this function — Paystack already got
 * its 200 response; this runs after the webhook ack.
 */
async function handleDomainPurchase(args: {
  reference: string;
  projectId: string;
  userId: string;
}): Promise<void> {
  // Look up the pending purchase row.
  const { data: pd, error: pdErr } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, hostname, wholesale_cost_cents, status")
    .eq("paystack_reference", args.reference)
    .maybeSingle();
  if (pdErr || !pd) {
    console.error("[domain_purchase] missing purchase row", args.reference, pdErr);
    return;
  }
  if (pd.status === "active" || pd.status === "registering") {
    return; // already handled / in flight
  }

  await supabaseAdmin
    .from("purchased_domains")
    .update({ status: "registering" })
    .eq("id", pd.id);

  try {
    const cf = await registerDomain({
      hostname: pd.hostname,
      expectedWholesaleCents: pd.wholesale_cost_cents,
    });

    // Add to our SaaS zone so traffic actually routes to the project.
    let connectedDomainId: string | null = null;
    try {
      const cfHostname = await createCustomHostname(pd.hostname, { sslMethod: "http" });
      const { data: pdRow } = await supabaseAdmin
        .from("project_domains")
        .insert({
          project_id: args.projectId,
          hostname: pd.hostname,
          status: "verifying",
          ssl_status: cfHostname.ssl?.status ?? "initializing",
          provider_hostname_id: cfHostname.id,
          verification_txt_name: `_purchased.${pd.hostname}`,
          verification_txt_value: "(petal-managed — no action needed)",
          last_checked_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      connectedDomainId = pdRow?.id ?? null;
    } catch (e) {
      console.error("[domain_purchase] custom hostname attach failed", e);
      // Domain is registered; user just has to manually connect it.
    }

    await supabaseAdmin
      .from("purchased_domains")
      .update({
        status: "active",
        registered_at: new Date().toISOString(),
        expires_at: cf.expires_at ?? null,
        auto_renew: cf.auto_renew ?? true,
        connected_domain_id: connectedDomainId,
        error_message: null,
      })
      .eq("id", pd.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration failed";
    console.error("[domain_purchase] register failed", pd.hostname, e);
    await supabaseAdmin
      .from("purchased_domains")
      .update({
        status: "failed",
        error_message: msg,
      })
      .eq("id", pd.id);
  }
}

