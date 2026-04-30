/**
 * POST /api/public/paystack/webhook
 *
 * Receives Paystack webhook events. Verifies the HMAC-SHA512 signature
 * before doing anything. On charge.success, credits the user via the
 * apply_paystack_topup / apply_paystack_plan_grant RPCs.
 *
 * Subscription events (subscription.create, subscription.disable,
 * subscription.not_renew, subscription.expiring_cards) and invoice events
 * (invoice.create, invoice.update, invoice.payment_failed) keep the local
 * `subscriptions` row + `paystack_invoices` audit trail in sync with Paystack
 * and trigger the right user emails.
 *
 * Idempotent: every event id is recorded in paystack_events.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  verifyWebhookSignature,
  getEnvironment,
  getSubscriptionManageLink,
} from "@/server/paystack.server";
import { startDomainRegistration } from "@/server/domain-purchase.server";
import {
  sendBillingEmail,
  billingItemLabel,
  formatMinorAmount,
} from "@/server/billing-email.server";

type AnyEvent = {
  event: string;
  data?: Record<string, unknown> & {
    id?: number | string;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    channel?: string | null;
    paid_at?: string | null;
    metadata?: Record<string, unknown> | string | null;
    plan?: { plan_code?: string } | null;
    subscription_code?: string;
    email_token?: string;
    next_payment_date?: string | null;
    customer?: {
      id?: number;
      email?: string;
      customer_code?: string;
    };
    authorization?: { authorization_code?: string };
    invoice_code?: string;
    description?: string | null;
    subscription?: {
      subscription_code?: string;
      next_payment_date?: string | null;
      status?: string;
    };
    transaction?: { reference?: string; amount?: number; currency?: string };
  };
};

const KNOWN_EVENTS = new Set([
  "charge.success",
  "charge.failed",
  "charge.abandoned",
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "subscription.expiring_cards",
  "invoice.create",
  "invoice.update",
  "invoice.payment_failed",
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

        let payload: AnyEvent;
        try {
          payload = JSON.parse(rawBody) as AnyEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const eventId = payload.data?.id != null ? String(payload.data.id) : null;
        if (!eventId) {
          // Some subscription events embed id under data.subscription.id; fall
          // back to a synthetic key from event + ref/code so we still dedupe.
          const fallback =
            payload.data?.subscription_code ||
            payload.data?.invoice_code ||
            payload.data?.reference ||
            null;
          if (!fallback) {
            console.warn("[paystack webhook] missing id and fallback", payload.event);
            return new Response("ok", { status: 200 });
          }
        }

        if (!KNOWN_EVENTS.has(payload.event)) {
          console.warn("[paystack webhook] unknown event type", payload.event);
          return new Response("ok", { status: 200 });
        }

        const dedupeKey =
          eventId ||
          `${payload.event}:${
            payload.data?.subscription_code ||
            payload.data?.invoice_code ||
            payload.data?.reference
          }`;

        // Idempotency.
        const { data: prior } = await supabaseAdmin
          .from("paystack_events")
          .select("id")
          .eq("id", dedupeKey)
          .maybeSingle();
        if (prior) return new Response("ok", { status: 200 });

        await supabaseAdmin.from("paystack_events").insert([
          {
            id: dedupeKey,
            type: payload.event,
            payload: JSON.parse(rawBody),
          },
        ]);

        const origin = new URL(request.url).origin;

        try {
          // ── Subscription lifecycle ──────────────────────────────────────
          if (payload.event === "subscription.create") {
            await handleSubscriptionCreate(payload);
            return new Response("ok", { status: 200 });
          }
          if (payload.event === "subscription.disable") {
            await handleSubscriptionDisable(payload);
            return new Response("ok", { status: 200 });
          }
          if (payload.event === "subscription.not_renew") {
            await supabaseAdmin
              .from("subscriptions")
              .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
              .eq("paystack_subscription_code", payload.data?.subscription_code ?? "");
            return new Response("ok", { status: 200 });
          }
          if (payload.event === "subscription.expiring_cards") {
            await handleExpiringCards(payload, origin);
            return new Response("ok", { status: 200 });
          }

          // ── Invoice events ──────────────────────────────────────────────
          if (payload.event === "invoice.create" || payload.event === "invoice.update") {
            await recordInvoice(payload);
            return new Response("ok", { status: 200 });
          }
          if (payload.event === "invoice.payment_failed") {
            await handleInvoiceFailed(payload, origin);
            return new Response("ok", { status: 200 });
          }

          // ── Charge events (existing behaviour + renewal handling) ───────
          if (
            payload.event !== "charge.success" ||
            payload.data?.status !== "success"
          ) {
            const reason: "failed" | "abandoned" | null =
              payload.event === "charge.failed"
                ? "failed"
                : payload.event === "charge.abandoned"
                  ? "abandoned"
                  : null;
            if (reason && payload.data?.reference) {
              await markChargeFailed(payload.data.reference, reason, origin);
            }
            return new Response("ok", { status: 200 });
          }

          await handleChargeSuccess(payload, origin);
          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("[paystack webhook] handler failed", payload.event, err);
          // Return 500 so Paystack retries with backoff.
          return new Response("Handler failed", { status: 500 });
        }
      },
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleSubscriptionCreate(payload: AnyEvent): Promise<void> {
  const sub = payload.data;
  if (!sub?.subscription_code || !sub.email_token || !sub.customer?.email) {
    console.warn("[paystack webhook] subscription.create missing fields");
    return;
  }
  // Resolve user by email — Paystack identifies customers by email which
  // matches the auth.users email we passed at /transaction/initialize.
  const userId = await resolveUserByEmail(sub.customer.email);
  if (!userId) {
    console.warn("[paystack webhook] subscription.create: unknown user", sub.customer.email);
    return;
  }
  // Map Paystack plan_code back to our internal billing_plans.code.
  const planCode = await resolvePlanCodeFromPaystack(sub.plan?.plan_code ?? null);

  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      provider: "paystack",
      plan_code: planCode,
      status: "active",
      cancel_at_period_end: false,
      paystack_subscription_code: sub.subscription_code,
      paystack_email_token: sub.email_token,
      paystack_customer_code: sub.customer.customer_code ?? null,
      paystack_authorization_code: sub.authorization?.authorization_code ?? null,
      next_payment_date: sub.next_payment_date ?? null,
      current_period_end: sub.next_payment_date ?? null,
      environment: getEnvironment(),
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "paystack_subscription_code" },
  );
}

async function handleSubscriptionDisable(payload: AnyEvent): Promise<void> {
  const subCode = payload.data?.subscription_code;
  if (!subCode) return;
  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("paystack_subscription_code", subCode)
    .maybeSingle();
  if (!row?.user_id) return;
  await supabaseAdmin.rpc("cancel_paystack_plan", {
    _user_id: row.user_id,
    _subscription_code: subCode,
  });
}

async function handleExpiringCards(payload: AnyEvent, origin: string): Promise<void> {
  // Paystack sends data as an ARRAY for this event — schema differs.
  const items = Array.isArray(payload.data) ? payload.data : [];
  for (const item of items as Array<{
    subscription?: { subscription_code?: string };
    customer?: { email?: string };
  }>) {
    const subCode = item.subscription?.subscription_code;
    const email = item.customer?.email;
    if (!subCode || !email) continue;
    const userId = await resolveUserByEmail(email);
    if (!userId) continue;
    const link = await getSubscriptionManageLink(subCode).catch(() => null);
    if (!link) continue;
    void sendBillingEmail({
      origin,
      templateName: "payment-failed",
      idempotencyKey: `expiring-card-${subCode}-${new Date().toISOString().slice(0, 7)}`,
      userId,
      templateData: {
        itemLabel: "subscription",
        reason: "failed",
        manageLink: link,
      },
    });
  }
}

async function recordInvoice(payload: AnyEvent): Promise<void> {
  const d = payload.data;
  if (!d?.invoice_code || !d.subscription?.subscription_code) return;
  const subCode = d.subscription.subscription_code;
  const { data: subRow } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("paystack_subscription_code", subCode)
    .maybeSingle();
  if (!subRow?.user_id) return;

  await supabaseAdmin.from("paystack_invoices").upsert(
    {
      user_id: subRow.user_id,
      subscription_code: subCode,
      invoice_code: d.invoice_code,
      amount_minor: Number(d.amount ?? 0),
      currency_code: String(d.transaction?.currency ?? "NGN"),
      status: String(d.status ?? "pending"),
      description: d.description ?? null,
      paid_at: d.paid_at ?? null,
      paystack_reference: d.transaction?.reference ?? null,
      event_payload: payload as unknown as Record<string, unknown>,
    } as never,
    { onConflict: "invoice_code" },
  );

  // Keep next_payment_date fresh on the subscription row.
  if (d.subscription.next_payment_date) {
    await supabaseAdmin
      .from("subscriptions")
      .update({
        next_payment_date: d.subscription.next_payment_date,
        updated_at: new Date().toISOString(),
      })
      .eq("paystack_subscription_code", subCode);
  }
}

async function handleInvoiceFailed(payload: AnyEvent, origin: string): Promise<void> {
  await recordInvoice(payload);
  const subCode = payload.data?.subscription?.subscription_code;
  if (!subCode) return;
  const { data: subRow } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plan_code")
    .eq("paystack_subscription_code", subCode)
    .maybeSingle();
  if (!subRow?.user_id) return;

  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "attention", updated_at: new Date().toISOString() })
    .eq("paystack_subscription_code", subCode);

  const link = await getSubscriptionManageLink(subCode).catch(() => null);
  void sendBillingEmail({
    origin,
    templateName: "payment-failed",
    idempotencyKey: `invoice-failed-${payload.data?.invoice_code ?? subCode}`,
    userId: subRow.user_id,
    templateData: {
      itemLabel: subRow.plan_code ?? "subscription",
      amountDisplay: formatMinorAmount(
        Number(payload.data?.amount ?? 0),
        String(payload.data?.transaction?.currency ?? "NGN"),
      ),
      reason: "failed",
      manageLink: link ?? undefined,
    },
  });
}

async function handleChargeSuccess(payload: AnyEvent, origin: string): Promise<void> {
  const ref = payload.data?.reference;
  if (!ref) return;

  // Renewal charges include a `plan` block AND have no matching pending tx
  // row (renewals don't go through /api/billing/initialize). Detect by
  // looking up our paystack_transactions table first.
  const { data: tx } = await supabaseAdmin
    .from("paystack_transactions")
    .select("*")
    .eq("reference", ref)
    .maybeSingle();

  if (!tx) {
    // No local tx — likely a subscription renewal. Credit via plan grant
    // looked up from the plan_code on the payload.
    if (!payload.data?.plan?.plan_code || !payload.data.customer?.email) {
      console.warn("[paystack webhook] charge.success with no tx and no plan", ref);
      return;
    }
    const userId = await resolveUserByEmail(payload.data.customer.email);
    if (!userId) return;
    const planCode = await resolvePlanCodeFromPaystack(payload.data.plan.plan_code);
    if (!planCode) return;
    await supabaseAdmin.rpc("apply_paystack_plan_grant", {
      _user_id: userId,
      _plan_code: planCode,
      _reference: ref,
    });
    void sendBillingEmail({
      origin,
      templateName: "payment-success",
      idempotencyKey: `billing-success-${ref}`,
      userId,
      templateData: {
        purpose: "plan",
        itemLabel: billingItemLabel({
          purpose: "plan",
          itemCode: planCode,
          usdAmountCents: 0,
        }),
        amountDisplay: formatMinorAmount(
          Number(payload.data.amount ?? 0),
          String(payload.data.currency ?? "NGN"),
        ),
        reference: ref,
        paidAt: payload.data.paid_at ?? new Date().toISOString(),
      },
    });
    return;
  }

  // Existing one-shot / first-charge path. (Behaviour preserved from before.)
  if (tx.status === "success") return;
  if (tx.status !== "pending") {
    console.warn("[paystack webhook] tx in terminal state", { ref, status: tx.status });
    return;
  }

  const currentEnv = getEnvironment();
  if (tx.environment !== currentEnv) {
    console.error("[paystack webhook] env mismatch", { ref, txEnv: tx.environment, currentEnv });
    await supabaseAdmin
      .from("paystack_transactions")
      .update({ status: "failed" })
      .eq("reference", ref)
      .eq("status", "pending");
    return;
  }
  if (
    payload.data?.amount != null &&
    Number(payload.data.amount) !== Number(tx.amount_minor)
  ) {
    // Plan checkouts: amount is overridden by Paystack to the plan's authoritative
    // amount, which may differ from our local resolved minor units (rounding /
    // FX drift). Don't reject — trust Paystack's amount and just log.
    if (tx.purpose !== "plan") {
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
      return;
    }
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
    return;
  }

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
    if (!tx.project_id) throw new Error("Add-on transaction missing project_id");
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
    if (!tx.project_id) throw new Error("Domain purchase missing project_id");
    try {
      await startDomainRegistration({ reference: ref });
    } catch (e) {
      console.error("[webhook] domain_purchase failed", e);
    }
  } else if (tx.purpose === "plan") {
    await supabaseAdmin.rpc("apply_paystack_plan_grant", {
      _user_id: tx.user_id,
      _plan_code: tx.item_code,
      _reference: ref,
    });
  } else {
    console.error("[paystack webhook] unknown purpose", tx.purpose);
    throw new Error("Unknown purpose");
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

  void sendBillingEmail({
    origin,
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
}

async function markChargeFailed(
  ref: string,
  reason: "failed" | "abandoned",
  origin: string,
): Promise<void> {
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
      origin,
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

// ─────────────────────────────────────────────────────────────────────────────
// Resolvers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveUserByEmail(email: string): Promise<string | null> {
  // Use admin auth API to look up the user by email.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    console.warn("[resolveUserByEmail] listUsers failed", error.message);
    return null;
  }
  // listUsers doesn't accept email filter — do a direct DB lookup instead.
  const { data: row } = await supabaseAdmin
    .schema("auth" as never)
    .from("users" as never)
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return (row as { id?: string } | null)?.id ?? data?.users[0]?.id ?? null;
}

async function resolvePlanCodeFromPaystack(
  paystackPlanCode: string | null,
): Promise<string | null> {
  if (!paystackPlanCode) return null;
  // Search across the per-currency columns.
  const { data: rows } = await supabaseAdmin
    .from("billing_plans")
    .select(
      "code, paystack_plan_code_ngn, paystack_plan_code_ghs, paystack_plan_code_kes, paystack_plan_code_zar, paystack_plan_code_usd",
    );
  if (!rows) return null;
  for (const r of rows) {
    if (
      r.paystack_plan_code_ngn === paystackPlanCode ||
      r.paystack_plan_code_ghs === paystackPlanCode ||
      r.paystack_plan_code_kes === paystackPlanCode ||
      r.paystack_plan_code_zar === paystackPlanCode ||
      r.paystack_plan_code_usd === paystackPlanCode
    ) {
      return r.code;
    }
  }
  return null;
}

// Domain registration orchestration lives in src/server/domain-purchase.server.ts.
