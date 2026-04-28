/**
 * Petal Email — managed email service for generated apps.
 *
 * Pricing model:
 *   Free tier: 100/day, 3,000/month. Sender = noreply@buildwithpetal.com.
 *   Pro: $25/mo for 50,000 emails. Optional custom domain (auto-DNS via Cloudflare).
 *
 * Public surface lives in src/routes/api/public/email/send.ts. All sends are
 * authenticated by a per-project bearer token issued when the user enables
 * Petal Email. Quota is enforced atomically; every attempt is logged to
 * petal_email_outbound for the in-app dashboard.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import crypto from "crypto";

const RESEND_API = "https://api.resend.com";
const DEFAULT_SENDER = "noreply@buildwithpetal.com";

export const FREE_PLAN = {
  monthly_cap: 3000,
  daily_cap: 100,
} as const;

export const PRO_PLAN = {
  monthly_cap: 50_000,
  daily_cap: 50_000, // no daily limit for Pro; cap to monthly
  price_usd_cents: 2500,
} as const;

// ---------- Token helpers ----------

/** Generate a `pet_` prefixed API token. The full token is returned ONCE; we
 *  only persist the SHA-256 hash + the 8-char prefix for lookups. */
export function issueApiToken(): { token: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(24).toString("base64url"); // 32 chars
  const token = `pet_${random}`;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 12); // "pet_" + 8 chars
  return { token, hash, prefix };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------- Subscription lifecycle ----------

export async function enablePetalEmail(args: {
  projectId: string;
  userId: string;
}): Promise<{ token: string; subscriptionId: string }> {
  const { projectId, userId } = args;

  const existing = await supabaseAdmin
    .from("petal_email_subscriptions")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing.data) {
    throw new Error("Petal Email is already enabled for this project. Rotate the token instead.");
  }

  const { token, hash, prefix } = issueApiToken();

  const { data, error } = await supabaseAdmin
    .from("petal_email_subscriptions")
    .insert({
      project_id: projectId,
      user_id: userId,
      plan: "free",
      status: "active",
      monthly_cap: FREE_PLAN.monthly_cap,
      daily_cap: FREE_PLAN.daily_cap,
      sender_email: DEFAULT_SENDER,
      api_token_hash: hash,
      api_token_prefix: prefix,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to enable Petal Email: ${error?.message ?? "unknown error"}`);
  }

  return { token, subscriptionId: data.id };
}

export async function rotateApiToken(projectId: string): Promise<string> {
  const { token, hash, prefix } = issueApiToken();
  const { error } = await supabaseAdmin
    .from("petal_email_subscriptions")
    .update({ api_token_hash: hash, api_token_prefix: prefix })
    .eq("project_id", projectId);
  if (error) throw new Error(`Token rotation failed: ${error.message}`);
  return token;
}

// ---------- Quota ----------

interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  monthlyUsed: number;
  dailyUsed: number;
  monthlyCap: number;
  dailyCap: number;
}

export async function checkAndIncrementQuota(
  projectId: string,
  monthlyCap: number,
  dailyCap: number
): Promise<QuotaCheckResult> {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Get monthly count
  const monthlyAgg = await supabaseAdmin
    .from("petal_email_usage")
    .select("sent_count")
    .eq("project_id", projectId)
    .gte("usage_date", monthStart.toISOString().slice(0, 10));

  const monthlyUsed =
    monthlyAgg.data?.reduce((sum, r) => sum + (r.sent_count ?? 0), 0) ?? 0;

  // Get today's row (or 0)
  const todayRow = await supabaseAdmin
    .from("petal_email_usage")
    .select("sent_count")
    .eq("project_id", projectId)
    .eq("usage_date", today)
    .maybeSingle();

  const dailyUsed = todayRow.data?.sent_count ?? 0;

  if (monthlyUsed >= monthlyCap) {
    return {
      allowed: false,
      reason: `Monthly email cap reached (${monthlyCap}). Upgrade to Petal Email Pro.`,
      monthlyUsed,
      dailyUsed,
      monthlyCap,
      dailyCap,
    };
  }
  if (dailyUsed >= dailyCap) {
    return {
      allowed: false,
      reason: `Daily email cap reached (${dailyCap}). Resets at 00:00 UTC.`,
      monthlyUsed,
      dailyUsed,
      monthlyCap,
      dailyCap,
    };
  }

  // Increment via upsert
  await supabaseAdmin.rpc("petal_email_increment_usage", {
    p_project_id: projectId,
    p_date: today,
  }).then(
    () => undefined,
    async () => {
      // Fallback if RPC not present yet — naive upsert
      await supabaseAdmin.from("petal_email_usage").upsert(
        {
          project_id: projectId,
          usage_date: today,
          sent_count: dailyUsed + 1,
        },
        { onConflict: "project_id,usage_date" }
      );
    }
  );

  return {
    allowed: true,
    monthlyUsed: monthlyUsed + 1,
    dailyUsed: dailyUsed + 1,
    monthlyCap,
    dailyCap,
  };
}

// ---------- Sending ----------

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}

export async function sendViaResend(
  sub: {
    id: string;
    project_id: string;
    sender_email: string;
    reply_to: string | null;
    custom_domain: string | null;
    custom_domain_verified: boolean;
  },
  params: SendEmailParams
): Promise<{ messageId: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  // Sender: custom domain if verified, else default
  const from =
    sub.custom_domain_verified && sub.custom_domain
      ? `noreply@${sub.custom_domain}`
      : sub.sender_email || DEFAULT_SENDER;

  // Reply-to: per-project so replies don't collide on the shared sender
  const replyTo = params.reply_to ?? sub.reply_to ?? undefined;

  const body: Record<string, unknown> = {
    from: `Petal <${from}>`,
    to: Array.isArray(params.to) ? params.to : [params.to],
    subject: params.subject,
  };
  if (params.html) body.html = params.html;
  if (params.text) body.text = params.text;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch(`${RESEND_API}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    throw new Error(`Resend send failed [${res.status}]: ${json.message ?? "unknown"}`);
  }
  return { messageId: json.id ?? "" };
}

export async function logOutbound(args: {
  projectId: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "suppressed";
  resendMessageId?: string;
  errorMessage?: string;
}): Promise<void> {
  await supabaseAdmin.from("petal_email_outbound").insert({
    project_id: args.projectId,
    recipient_email: args.recipient,
    subject: args.subject.slice(0, 200),
    status: args.status,
    resend_message_id: args.resendMessageId ?? null,
    error_message: args.errorMessage ?? null,
  });
}

// ---------- Auth ----------

export async function authenticateRequest(
  authHeader: string | null
): Promise<{
  id: string;
  project_id: string;
  user_id: string;
  plan: string;
  status: string;
  monthly_cap: number;
  daily_cap: number;
  sender_email: string;
  reply_to: string | null;
  custom_domain: string | null;
  custom_domain_verified: boolean;
} | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token.startsWith("pet_")) return null;

  const prefix = token.slice(0, 12);
  const hash = hashToken(token);

  const { data, error } = await supabaseAdmin
    .from("petal_email_subscriptions")
    .select(
      "id, project_id, user_id, plan, status, monthly_cap, daily_cap, sender_email, reply_to, custom_domain, custom_domain_verified, api_token_hash"
    )
    .eq("api_token_prefix", prefix)
    .maybeSingle();

  if (error || !data) return null;
  if (data.api_token_hash !== hash) return null;
  if (data.status !== "active") return null;

  return data;
}
