/**
 * POST /api/public/billing/webhook?env=sandbox|live
 *
 * Stripe webhook handler. Public (under /api/public/*) so Lovable's platform
 * auth doesn't shield it from Stripe. Security comes from HMAC-SHA256
 * signature verification using the per-env webhook secret.
 *
 * Events handled:
 *  - checkout.session.completed: top-up grant (one-time pack purchases)
 *  - customer.subscription.created / updated / deleted: write to subscriptions
 *    table and apply plan changes (downgrades + cancellations are deferred
 *    to period end via cancel_at_period_end / pending_plan_code, then a
 *    pg_cron job in the database flips the wallet over).
 *  - invoice.paid: monthly renewal grant (top up monthly_credits_remaining).
 */
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyStripeWebhook, type StripeEnv } from "@/server/stripe.server";

type SubItemWithPeriod = Stripe.SubscriptionItem & {
  current_period_start?: number;
  current_period_end?: number;
};

function priceIdFromItem(item: SubItemWithPeriod | undefined): string | null {
  if (!item) return null;
  const meta = (item.price.metadata?.lovable_external_id as string | undefined) ?? null;
  return meta ?? item.price.id;
}

function planCodeFromPriceId(priceId: string | null): string {
  if (!priceId) return "free";
  if (priceId.startsWith("plan_pro")) return "pro";
  if (priceId.startsWith("plan_business")) return "business";
  return "free";
}

function packCodeFromPriceId(priceId: string): string | null {
  // pack_50_onetime → pack_50
  const m = priceId.match(/^(pack_\d+)/);
  return m ? m[1] : null;
}

async function recordEvent(eventId: string, type: string, payload: unknown): Promise<boolean> {
  // Insert into stripe_events for idempotency. If it already exists, return
  // false so the caller knows to skip processing.
  const { error } = await supabaseAdmin
    .from("stripe_events")
    .insert({ id: eventId, type, payload: payload as never });
  if (error) {
    if (error.code === "23505") return false; // unique violation
    console.error("[webhook] failed to record event", error);
  }
  return true;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, env: StripeEnv) {
  const userId = (session.metadata?.userId as string | undefined) ?? null;
  const priceId = (session.metadata?.priceId as string | undefined) ?? null;
  if (!userId || !priceId) {
    console.warn("[webhook] checkout.completed missing metadata");
    return;
  }
  // Subscriptions are handled via customer.subscription.created — we only
  // care about one-time top-up purchases here.
  if (session.mode !== "payment") return;

  const packCode = packCodeFromPriceId(priceId);
  if (!packCode) return;

  const { error } = await supabaseAdmin.rpc("apply_topup_purchase", {
    _user_id: userId,
    _pack_code: packCode,
    _stripe_session_id: session.id,
    _environment: env,
  });
  if (error) console.error("[webhook] apply_topup_purchase failed", error);
}

async function upsertSubscription(sub: Stripe.Subscription, env: StripeEnv) {
  const userId = (sub.metadata?.userId as string | undefined) ?? null;
  if (!userId) {
    console.warn("[webhook] subscription missing userId metadata", sub.id);
    return;
  }
  const item = sub.items.data[0] as SubItemWithPeriod | undefined;
  const priceId = priceIdFromItem(item);
  const planCode = planCodeFromPriceId(priceId);
  const productId = (item?.price.product as string | undefined) ?? null;
  const periodStart = item?.current_period_start ?? null;
  const periodEnd = item?.current_period_end ?? null;

  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer as string,
      product_id: productId,
      price_id: priceId ?? "",
      plan_code: planCode,
      status: sub.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  return { userId, planCode, periodEnd };
}

async function handleSubscriptionCreated(sub: Stripe.Subscription, env: StripeEnv) {
  const result = await upsertSubscription(sub, env);
  if (!result) return;

  // Grant monthly credits immediately on activation. Statuses we accept as
  // "paid + active": active, trialing.
  if ((sub.status === "active" || sub.status === "trialing") && result.periodEnd) {
    const { error } = await supabaseAdmin.rpc("apply_subscription_activated", {
      _user_id: result.userId,
      _plan_code: result.planCode,
      _stripe_customer_id: sub.customer as string,
      _stripe_subscription_id: sub.id,
      _current_period_end: new Date(result.periodEnd * 1000).toISOString(),
    });
    if (error) console.error("[webhook] apply_subscription_activated failed", error);
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription, env: StripeEnv) {
  await upsertSubscription(sub, env);
  // Note: on plan changes we don't touch credits here. If Stripe issues a
  // proration invoice and that invoice is paid, invoice.paid will fire and
  // top up credits. Cancellations + downgrades are deferred to period end
  // and applied by pg_cron (apply_period_end_changes).
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription, env: StripeEnv) {
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", sub.id)
    .eq("environment", env);

  const userId = (sub.metadata?.userId as string | undefined) ?? null;
  if (!userId) return;
  await supabaseAdmin
    .from("user_wallets")
    .update({
      plan_code: "free",
      monthly_credits_remaining: 0,
      subscription_status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

async function handleInvoicePaid(invoice: Stripe.Invoice, env: StripeEnv) {
  // Renewal invoice (billing_reason === 'subscription_cycle') tops up credits.
  // Initial invoice (subscription_create) is already handled by
  // subscription.created — skip to avoid double-grant.
  if (invoice.billing_reason !== "subscription_cycle") return;

  // Stripe types model invoice→subscription as either string id or expanded
  // object. We just need the id for a lookup, so coerce.
  const subRef = (invoice as unknown as { subscription?: string | { id?: string } })
    .subscription;
  const subscriptionId =
    typeof subRef === "string" ? subRef : subRef?.id ?? null;
  if (!subscriptionId) return;

  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plan_code, current_period_end")
    .eq("stripe_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();
  if (!row || !row.current_period_end) return;

  const { error } = await supabaseAdmin.rpc("apply_monthly_renewal", {
    _user_id: row.user_id,
    _plan_code: row.plan_code,
    _current_period_end: row.current_period_end,
  });
  if (error) console.error("[webhook] apply_monthly_renewal failed", error);
}

export const Route = createFileRoute("/api/public/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const rawEnv = url.searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return new Response(
            JSON.stringify({ received: true, ignored: "invalid env" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        const env: StripeEnv = rawEnv;

        const rawBody = await request.text();
        const signature = request.headers.get("stripe-signature");

        let event: { id?: string; type: string; data: { object: unknown } };
        try {
          event = (await verifyStripeWebhook(rawBody, signature, env)) as typeof event;
        } catch (err) {
          console.warn("[webhook] verify failed", err);
          return new Response("Invalid signature", { status: 400 });
        }

        // Idempotency
        if (event.id) {
          const proceed = await recordEvent(event.id, event.type, event);
          if (!proceed) {
            return new Response(JSON.stringify({ received: true, duplicate: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        try {
          switch (event.type) {
            case "checkout.session.completed":
              await handleCheckoutCompleted(
                event.data.object as Stripe.Checkout.Session,
                env,
              );
              break;
            case "customer.subscription.created":
              await handleSubscriptionCreated(
                event.data.object as Stripe.Subscription,
                env,
              );
              break;
            case "customer.subscription.updated":
              await handleSubscriptionUpdated(
                event.data.object as Stripe.Subscription,
                env,
              );
              break;
            case "customer.subscription.deleted":
              await handleSubscriptionDeleted(
                event.data.object as Stripe.Subscription,
                env,
              );
              break;
            case "invoice.paid":
              await handleInvoicePaid(event.data.object as Stripe.Invoice, env);
              break;
            default:
              // Acknowledge unhandled events so Stripe stops retrying.
              break;
          }
        } catch (err) {
          console.error(`[webhook] handler error for ${event.type}`, err);
          return new Response("Webhook handler error", { status: 500 });
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
