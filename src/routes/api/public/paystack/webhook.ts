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

