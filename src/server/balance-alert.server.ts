/**
 * Low-balance email for partner accounts (Custard AI's service account).
 *
 * Called every 5 minutes from the turn-resume cron but only checks once an
 * hour. When the account's available credits fall below the threshold, the
 * owner (PARTNER_ALERT_RECIPIENT) gets one email;
 * the alert re-arms once the balance is back at or above the threshold, so
 * each dip sends exactly one email. State lives in `balance_alerts`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Credits below which the owner is emailed about Custard's balance. */
export const PARTNER_LOW_BALANCE_CREDITS = 1000;

/** The owner's address for partner balance alerts. */
export const PARTNER_ALERT_RECIPIENT = "ikemadu26@gmail.com";

/** The balance is checked at most once per hour (the cron ticks every 5 min). */
export const BALANCE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** True when the last check is older than the interval (or never ran). */
export function checkIsDue(lastCheckedAt: string | null, now: number = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  return !Number.isFinite(last) || now - last >= BALANCE_CHECK_INTERVAL_MS;
}

export type AlertDecision = "send" | "rearm" | "none";

/** One email per dip below the threshold; re-arm once it recovers. */
export function alertDecision(balance: number, threshold: number, alertedAt: string | null): AlertDecision {
  if (balance < threshold) return alertedAt ? "none" : "send";
  return alertedAt ? "rearm" : "none";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Queue the owner notice through Petal's own email sender. */
export async function emailAdmins(
  origin: string,
  name: string,
  balance: number,
  threshold: number,
  key: string,
): Promise<string | null> {
  const to = [PARTNER_ALERT_RECIPIENT];
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return "BUILDER_SHARED_SECRET not configured";
  const errors: string[] = [];
  for (const [i, recipientEmail] of to.entries()) {
    const res = await fetch(new URL("/lovable/email/transactional/send", origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret },
      body: JSON.stringify({
        templateName: "partner-low-balance",
        recipientEmail,
        idempotencyKey: `${key}-${i}`,
        templateData: { partnerName: name, balance: fmt(balance), threshold: fmt(threshold) },
      }),
    }).catch((e: unknown) => new Response(String(e), { status: 599 }));
    if (!res.ok) errors.push(`send ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  }
  return errors.length === to.length ? errors.join("; ") : null;
}

export type BalanceAlertResult = {
  balance: number | null;
  decision: AlertDecision | "skipped";
  emailed: boolean;
  error: string | null;
};

/** Check Custard's balance and email the owner on a dip below the threshold. */
export async function checkPartnerBalance(origin: string): Promise<BalanceAlertResult> {
  const { serviceUserId } = await import("@/server/service-api.server");
  const userId = await serviceUserId();
  if (!userId) return { balance: null, decision: "skipped", emailed: false, error: "no partner account" };
  const threshold = PARTNER_LOW_BALANCE_CREDITS;

  const { data: state } = await supabaseAdmin
    .from("balance_alerts")
    .select("alerted_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!checkIsDue(state?.updated_at ?? null)) {
    return { balance: null, decision: "skipped", emailed: false, error: null };
  }
  const { data: bal, error: balErr } = await supabaseAdmin.rpc("available_credits", { _user_id: userId });
  if (balErr || bal == null) return { balance: null, decision: "skipped", emailed: false, error: balErr?.message ?? "no balance" };
  const balance = Number(bal);
  const decision = alertDecision(balance, threshold, state?.alerted_at ?? null);

  let emailed = false;
  let error: string | null = null;
  let alertedAt: string | null = state?.alerted_at ?? null;
  if (decision === "send") {
    error = await emailAdmins(origin, "Custard AI", balance, threshold, `partner-low-balance-${userId}-${new Date().toISOString().slice(0, 13)}`);
    if (!error) {
      emailed = true;
      alertedAt = new Date().toISOString();
    }
  } else if (decision === "rearm") {
    alertedAt = null;
  }

  await supabaseAdmin.from("balance_alerts").upsert(
    { user_id: userId, threshold, alerted_at: alertedAt, last_balance: balance, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return { balance, decision, emailed, error };
}
