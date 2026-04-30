/**
 * Petal Email — managed email service for generated apps.
 *
 * Pricing model:
 *   Free tier: 100/day, 3,000/month. Sender = noreply@buildwithpetal.com.
 *   Pro: $25/mo for 50,000 emails. Optional custom domain (auto-DNS via Cloudflare).
 *
 * Public surface lives in src/routes/api/public/email/send.ts. All sends are
 * authenticated by a per-project bearer token issued when the user enables
 * Petal Email. Quota is enforced atomically (DB RPC) AFTER a successful send,
 * so Resend failures don't burn quota. Every attempt is logged to
 * petal_email_outbound for the in-app dashboard. Idempotency-Key forwarded to
 * Resend to make retries safe.
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
 *  only persist the SHA-256 hash + the 12-char prefix for lookups. */
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

// ---------- Quota (atomic via RPC) ----------

interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  monthlyUsed: number;
  dailyUsed: number;
  monthlyCap: number;
  dailyCap: number;
}

export async function reserveQuota(
  projectId: string,
  monthlyCap: number,
  dailyCap: number
): Promise<QuotaCheckResult> {
  const { data, error } = await supabaseAdmin.rpc("increment_petal_email_usage", {
    p_project_id: projectId,
    p_monthly_cap: monthlyCap,
    p_daily_cap: dailyCap,
  });

  if (error) {
    throw new Error(`Quota check failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    reason: row?.reason ?? undefined,
    monthlyUsed: row?.monthly_used ?? 0,
    dailyUsed: row?.daily_used ?? 0,
    monthlyCap,
    dailyCap,
  };
}

/** Compensating decrement when the actual Resend send fails. */
export async function releaseQuota(projectId: string): Promise<void> {
  await supabaseAdmin.rpc("decrement_petal_email_usage", {
    p_project_id: projectId,
  });
}

// ---------- Suppression ----------

/** Returns the subset of recipients NOT on the suppression list. */
export async function filterSuppressed(
  projectId: string,
  recipients: string[]
): Promise<{ allowed: string[]; suppressed: string[] }> {
  const lower = recipients.map((r) => r.toLowerCase());
  const { data } = await supabaseAdmin
    .from("petal_email_suppressions")
    .select("recipient_email")
    .eq("project_id", projectId)
    .in("recipient_email", lower);
  const blocked = new Set((data ?? []).map((r) => r.recipient_email.toLowerCase()));
  const allowed: string[] = [];
  const suppressed: string[] = [];
  for (const r of recipients) {
    (blocked.has(r.toLowerCase()) ? suppressed : allowed).push(r);
  }
  return { allowed, suppressed };
}

export async function addSuppression(args: {
  projectId: string;
  email: string;
  reason: "bounced" | "complained" | "unsubscribed" | "manual";
  sourceMessageId?: string;
}): Promise<void> {
  await supabaseAdmin.from("petal_email_suppressions").upsert(
    {
      project_id: args.projectId,
      recipient_email: args.email.toLowerCase(),
      reason: args.reason,
      source_message_id: args.sourceMessageId ?? null,
    } as never,
    { onConflict: "project_id,recipient_email" }
  );
}

// ---------- Sending ----------

export interface SendEmailParams {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  scheduled_at?: string;
  attachments?: {
    filename: string;
    content?: string;
    path?: string;
    content_type?: string;
    content_id?: string;
  }[];
  idempotency_key?: string;
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
): Promise<{ messageId: string; idempotencyKey: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  // Sender: custom domain if verified, else default
  const fromAddr =
    sub.custom_domain_verified && sub.custom_domain
      ? `noreply@${sub.custom_domain}`
      : sub.sender_email || DEFAULT_SENDER;

  // Friendly name: only prefix "Petal" on the shared sender. Custom-domain
  // projects send as their own domain with no Petal-branded display name.
  const from =
    sub.custom_domain_verified && sub.custom_domain ? fromAddr : `Petal <${fromAddr}>`;

  const replyTo = params.reply_to ?? sub.reply_to ?? undefined;

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(params.to) ? params.to : [params.to],
    subject: params.subject,
  };
  if (params.cc) body.cc = Array.isArray(params.cc) ? params.cc : [params.cc];
  if (params.bcc) body.bcc = Array.isArray(params.bcc) ? params.bcc : [params.bcc];
  if (params.html) body.html = params.html;
  if (params.text) body.text = params.text;
  if (replyTo) body.reply_to = replyTo;
  if (params.headers) body.headers = params.headers;
  if (params.tags?.length) body.tags = params.tags;
  if (params.scheduled_at) body.scheduled_at = params.scheduled_at;
  if (params.attachments?.length) body.attachments = params.attachments;

  // Idempotency: caller can pass one (e.g., booking-confirm-<uuid>); else mint one.
  // Resend keeps idempotency keys for 24h; matching key + same payload = same id.
  const idempotencyKey = params.idempotency_key ?? crypto.randomUUID();

  const res = await fetch(`${RESEND_API}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!res.ok) {
    const detail = json.message ?? json.name ?? "unknown";
    throw new Error(`Resend send failed [${res.status}]: ${detail}`);
  }
  return { messageId: json.id ?? "", idempotencyKey };
}

export async function logOutbound(args: {
  projectId: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "suppressed" | "bounced" | "complained";
  resendMessageId?: string;
  errorMessage?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await supabaseAdmin.from("petal_email_outbound").insert({
    project_id: args.projectId,
    recipient_email: args.recipient,
    subject: args.subject.slice(0, 200),
    status: args.status,
    resend_message_id: args.resendMessageId ?? null,
    error_message: args.errorMessage ?? null,
    idempotency_key: args.idempotencyKey ?? null,
    metadata: (args.metadata ?? {}) as never,
  } as never);
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

  // Constant-time hash compare
  const expected = Buffer.from(data.api_token_hash, "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  if (data.status !== "active") return null;

  return data;
}

// ---------- Webhook signature verification (Svix-style) ----------

/**
 * Verify a Resend webhook signature. Resend uses Svix under the hood:
 *   svix-id        → message id
 *   svix-timestamp → unix seconds
 *   svix-signature → space-separated "v1,<base64>" entries (any one must match)
 *
 * Signed string = `${id}.${timestamp}.${rawBody}`
 * Key = base64-decode of secret after the `whsec_` prefix.
 */
export function verifyResendWebhook(args: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  secret: string;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = args;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Replay guard (default ±5min)
  const tolerance = args.toleranceSeconds ?? 5 * 60;
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) return false;

  const secretBody = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretBody, "base64");
  } catch {
    return false;
  }

  const signed = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");

  const candidates = svixSignature
    .split(" ")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1,"))
    .map((p) => p.slice(3));

  for (const cand of candidates) {
    const a = Buffer.from(cand);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}
