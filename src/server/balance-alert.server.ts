/**
 * Low-balance email for partner accounts (Custard AI's service account).
 *
 * Runs every 5 minutes from the turn-resume cron. When the account's
 * available credits fall below the threshold, Petal's admins get one email;
 * the alert re-arms once the balance is back at or above the threshold, so
 * each dip sends exactly one email. State lives in `balance_alerts`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Credits below which the owner is emailed about Custard's balance. */
export const PARTNER_LOW_BALANCE_CREDITS = 1000;

export type AlertDecision = "send" | "rearm" | "none";

/** One email per dip below the threshold; re-arm once it recovers. */
export function alertDecision(balance: number, threshold: number, alertedAt: string | null): AlertDecision {
  if (balance < threshold) return alertedAt ? "none" : "send";
  return alertedAt ? "rearm" : "none";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function emailAdmins(name: string, balance: number, threshold: number): Promise<string | null> {
  const { resolveAdminRecipients } = await import("@/server/self-learning-digest.server");
  const to = await resolveAdminRecipients();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS || "Petal <noreply@buildwithpetal.com>";
  if (!to.length) return "no admin recipients";
  if (!apiKey) return "RESEND_API_KEY not configured";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18181b;line-height:1.5">
<p><strong>${escapeHtml(name)}</strong> has <strong>${fmt(balance)} credits</strong> left, below your ${fmt(threshold)}-credit alert.</p>
<p>Their builds and Shared Cloud keep running until the balance reaches zero. After that, sign-in and data on their sites pause 48 hours later, while the pages stay online.</p>
<p>You'll get this email again the next time the balance drops below ${fmt(threshold)} after a top-up.</p>
<p style="color:#71717a;font-size:13px">Petal</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: `Petal · ${name} is below ${fmt(threshold)} credits (${fmt(balance)} left)`,
      html,
      tags: [{ name: "kind", value: "partner_low_balance" }],
    }),
  });
  if (!res.ok) return `Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
  return null;
}

export type BalanceAlertResult = {
  balance: number | null;
  decision: AlertDecision | "skipped";
  emailed: boolean;
  error: string | null;
};

/** Check Custard's balance and email the owner on a dip below the threshold. */
export async function checkPartnerBalance(): Promise<BalanceAlertResult> {
  const { serviceUserId } = await import("@/server/service-api.server");
  const userId = await serviceUserId();
  if (!userId) return { balance: null, decision: "skipped", emailed: false, error: "no partner account" };
  const threshold = PARTNER_LOW_BALANCE_CREDITS;

  const [{ data: bal, error: balErr }, { data: state }] = await Promise.all([
    supabaseAdmin.rpc("available_credits", { _user_id: userId }),
    supabaseAdmin.from("balance_alerts").select("alerted_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (balErr || bal == null) return { balance: null, decision: "skipped", emailed: false, error: balErr?.message ?? "no balance" };
  const balance = Number(bal);
  const decision = alertDecision(balance, threshold, state?.alerted_at ?? null);

  let emailed = false;
  let error: string | null = null;
  let alertedAt: string | null = state?.alerted_at ?? null;
  if (decision === "send") {
    error = await emailAdmins("Custard AI", balance, threshold);
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
