/**
 * Daily cron that emails users about Paystack subscription lifecycle:
 *
 *   (a) Pre-renewal reminders at T-7 / T-3 / T-1 days before next_payment_date.
 *   (b) Payment-failed follow-ups while a sub is stuck in `status='attention'`
 *       (capped at ~3 nudges over 14 days via daily idempotency keys).
 *   (c) Expired downgrade: current_period_end < now AND no successful charge
 *       since (or cancel_at_period_end=true and period ended). Sends the
 *       `subscription-expired` email and drops the wallet plan back to free
 *       via the existing cancel_paystack_plan RPC.
 *
 * Auth: `x-petal-cron-secret` matching BUILDER_SHARED_SECRET, same as the
 * other Petal crons. Schedule via pg_cron, daily at 09:00 UTC.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionManageLink } from "@/server/paystack.server";
import { sendBillingEmail, formatMinorAmount } from "@/server/billing-email.server";

const REMINDER_DAYS = [7, 3, 1];
const FOLLOWUP_NUDGE_CAP_DAYS = 14;

type SubRow = {
  user_id: string;
  plan_code: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  next_payment_date: string | null;
  paystack_subscription_code: string | null;
  updated_at: string;
};

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function planDisplayName(code: string | null | undefined): Promise<string> {
  if (!code) return "Your plan";
  const { data } = await supabaseAdmin
    .from("billing_plans")
    .select("name")
    .eq("code", code)
    .maybeSingle();
  const name = (data as { name?: string } | null)?.name;
  return name ? `${name} plan` : `${code} plan`;
}

async function lastSuccessfulInvoiceAt(subCode: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("paystack_invoices")
    .select("paid_at, created_at")
    .eq("subscription_code", subCode)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { paid_at?: string; created_at?: string } | null;
  return row?.paid_at ?? row?.created_at ?? null;
}

async function lastFailedInvoiceAt(subCode: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("paystack_invoices")
    .select("created_at")
    .eq("subscription_code", subCode)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at?: string } | null)?.created_at ?? null;
}

async function processSubscriptions(origin: string): Promise<{
  preRenewal: number;
  failedNudge: number;
  expired: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, plan_code, status, cancel_at_period_end, current_period_end, next_payment_date, paystack_subscription_code, updated_at",
    )
    .eq("provider", "paystack");
  if (error) throw new Error(`list subscriptions: ${error.message}`);
  const subs = (data ?? []) as SubRow[];

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let preRenewal = 0;
  let failedNudge = 0;
  let expired = 0;

  for (const sub of subs) {
    if (!sub.paystack_subscription_code) continue;
    const subCode = sub.paystack_subscription_code;
    const planName = await planDisplayName(sub.plan_code);

    // ── (a) Pre-renewal reminders ─────────────────────────────────────────
    if (
      sub.status === "active" &&
      !sub.cancel_at_period_end &&
      sub.next_payment_date
    ) {
      const renewMs = new Date(sub.next_payment_date).getTime();
      const daysLeft = Math.ceil((renewMs - now) / (24 * 60 * 60 * 1000));
      if (REMINDER_DAYS.includes(daysLeft)) {
        const idempotencyKey = `sub-renewal-${subCode}-${today}-pre-${daysLeft}`;
        const manageLink =
          (await getSubscriptionManageLink(subCode).catch(() => null)) ?? origin;
        await sendBillingEmail({
          origin,
          templateName: "subscription-renewal-reminder",
          idempotencyKey,
          userId: sub.user_id,
          templateData: {
            planName,
            renewsOn: sub.next_payment_date,
            daysLeft,
            manageLink,
          },
        });
        preRenewal++;
      }
    }

    // ── (b) Payment-failed nudges ─────────────────────────────────────────
    if (sub.status === "attention") {
      const lastFail = await lastFailedInvoiceAt(subCode);
      const lastOk = await lastSuccessfulInvoiceAt(subCode);
      const failMs = lastFail ? new Date(lastFail).getTime() : 0;
      const okMs = lastOk ? new Date(lastOk).getTime() : 0;
      // Only nudge if the last failure is still unresolved (no success since)
      // and we're inside the nudge window.
      if (failMs > okMs && failMs > 0) {
        const daysSinceFail = Math.floor((now - failMs) / (24 * 60 * 60 * 1000));
        if (daysSinceFail <= FOLLOWUP_NUDGE_CAP_DAYS) {
          // Send on day 0, 3, 7, 14 (≤ 3 nudges total → email queue dedupes
          // by message_id so re-running the cron the same day is a no-op).
          if ([0, 3, 7, FOLLOWUP_NUDGE_CAP_DAYS].includes(daysSinceFail)) {
            const idempotencyKey = `sub-renewal-${subCode}-${today}-failnudge-${daysSinceFail}`;
            const manageLink =
              (await getSubscriptionManageLink(subCode).catch(() => null)) ?? origin;
            await sendBillingEmail({
              origin,
              templateName: "subscription-payment-failed-followup",
              idempotencyKey,
              userId: sub.user_id,
              templateData: {
                planName,
                failedOn: lastFail,
                manageLink,
              },
            });
            failedNudge++;
          }
        }
      }
    }

    // ── (c) Expired downgrade ─────────────────────────────────────────────
    if (sub.current_period_end) {
      const periodEndMs = new Date(sub.current_period_end).getTime();
      if (periodEndMs < now) {
        const lastOk = await lastSuccessfulInvoiceAt(subCode);
        const okMs = lastOk ? new Date(lastOk).getTime() : 0;
        // Expired if either cancel_at_period_end OR no successful charge after
        // the period closed.
        const trulyExpired =
          sub.cancel_at_period_end || okMs <= periodEndMs;
        if (trulyExpired && sub.status !== "canceled") {
          const idempotencyKey = `sub-renewal-${subCode}-expired-${sub.current_period_end.slice(0, 10)}`;
          await sendBillingEmail({
            origin,
            templateName: "subscription-expired",
            idempotencyKey,
            userId: sub.user_id,
            templateData: {
              planName,
              endedOn: sub.current_period_end,
              renewUrl: origin,
            },
          });
          // Drop wallet plan back to free + mark sub canceled. Idempotent.
          await supabaseAdmin
            .rpc("cancel_paystack_plan", {
              _user_id: sub.user_id,
              _subscription_code: subCode,
            })
            .then((r) => {
              if (r.error) {
                console.warn(
                  "[sub-renewal-cron] cancel_paystack_plan failed",
                  subCode,
                  r.error.message,
                );
              }
            });
          expired++;
        }
      }
    }
  }

  return { preRenewal, failedNudge, expired };
}

export const Route = createFileRoute(
  "/api/public/cron/subscription-renewal-reminder",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const origin = new URL(request.url).origin;
          const result = await processSubscriptions(origin);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[sub-renewal-cron] failed", msg);
          return new Response(msg, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const origin = new URL(request.url).origin;
          const result = await processSubscriptions(origin);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});

void formatMinorAmount;
