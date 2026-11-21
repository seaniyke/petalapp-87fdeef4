/**
 * AI gateway health: one place that knows WHY an AI call was refused and
 * whether the live service can reach the AI gateway right now.
 *
 * - `classifyGatewayFailure` turns a non-2xx gateway reply into a kind plus a
 *   short safe reason (never key material), so every logged failure says why.
 * - `checkGatewayHealth` runs from the turn-resume cron (every 5 min): it reads
 *   the latest real AI calls, sends one tiny canary only when there was no
 *   recent traffic, and emails the owner ONCE per outage (re-armed on
 *   recovery). Alert state reuses `balance_alerts` under a fixed sentinel id.
 *
 * Gateway rules: 403/401 are never retried in-run and keys are never swapped
 * automatically; the fix for a stale key is re-publishing / rotating it, which
 * needs a person — so the job here is to find out within minutes, not days.
 */

export type GatewayFailureKind =
  | "key_not_registered"
  | "key_missing_or_invalid"
  | "credits"
  | "workspace_limit"
  | "provider_denied"
  | "rate_limited"
  | "unavailable"
  | "bad_request"
  | "other";

export interface GatewayFailure {
  kind: GatewayFailureKind;
  /** Short, user-safe reason taken from the gateway reply. */
  reason: string;
  /** True when only a person can fix it (re-publish, rotate key, top up). */
  needsOperator: boolean;
}

export function classifyGatewayFailure(status: number, bodyText: string): GatewayFailure {
  const text = (bodyText || "").slice(0, 2000);
  let type = "";
  let message = "";
  try {
    const j = JSON.parse(text) as { type?: string; message?: string; error?: { type?: string; message?: string; code?: string } | string };
    const e = typeof j.error === "object" && j.error ? j.error : null;
    type = String(e?.type ?? e?.code ?? j.type ?? "");
    message = String(e?.message ?? (typeof j.error === "string" ? j.error : "") ?? j.message ?? "");
    if (!message && j.message) message = String(j.message);
  } catch {
    message = text;
  }
  const hay = `${type} ${message}`.toLowerCase();
  const reason = (message || type || `HTTP ${status}`).replace(/\s+/g, " ").trim().slice(0, 200);
  if (/not[_ ]registered/.test(hay)) return { kind: "key_not_registered", reason, needsOperator: true };
  if (status === 401) return { kind: "key_missing_or_invalid", reason, needsOperator: true };
  if (status === 402) return { kind: "credits", reason, needsOperator: true };
  if (status === 403 && /credit_limit|limit_reached|ai.*disabled/.test(hay)) return { kind: "workspace_limit", reason, needsOperator: true };
  if (status === 403) return { kind: "provider_denied", reason, needsOperator: true };
  if (status === 429) return { kind: "rate_limited", reason, needsOperator: false };
  if (status >= 500) return { kind: "unavailable", reason, needsOperator: false };
  if (status === 400) return { kind: "bad_request", reason, needsOperator: false };
  return { kind: "other", reason, needsOperator: false };
}

/** Compact text stored in `ai_call_log.error_message`. */
export function failureLabel(status: number, f: GatewayFailure): string {
  return `HTTP ${status} ${f.kind}: ${f.reason}`.slice(0, 300);
}

/** Read a failed reply's body without consuming the caller's copy. */
export async function readFailure(res: Response): Promise<GatewayFailure | null> {
  if (res.ok) return null;
  let text = "";
  try { text = await res.clone().text(); } catch { /* body gone */ }
  return classifyGatewayFailure(res.status, text);
}

// ---------------------------------------------------------------------------
// Health decision (pure) + cron check
// ---------------------------------------------------------------------------

/** Sentinel row id in `balance_alerts` holding the gateway alert state. */
export const GATEWAY_ALERT_ID = "00000000-0000-0000-0000-00000000a1a1";
/** Calls newer than this count as "recent" evidence. */
export const RECENT_WINDOW_MS = 10 * 60 * 1000;
/** While an outage is already alerted, canary at most this often. */
export const DOWN_CANARY_INTERVAL_MS = 60 * 60 * 1000;

export interface CallSample { status: number; error_message: string | null; created_at: string }

export type HealthVerdict = { state: "ok" | "down" | "unknown"; kind: GatewayFailureKind | null; reason: string | null };

/**
 * Newest-first samples → verdict. Down only when the newest call failed with
 * an operator-only kind (one success after it means the gateway is fine).
 */
export function verdictFrom(samples: CallSample[]): HealthVerdict {
  const newest = samples[0];
  if (!newest) return { state: "unknown", kind: null, reason: null };
  if (newest.status >= 200 && newest.status < 300) return { state: "ok", kind: null, reason: null };
  const m = /^HTTP \d+ ([a-z_]+): (.*)$/.exec(newest.error_message ?? "");
  const kind = (m?.[1] as GatewayFailureKind | undefined) ?? (newest.status === 401 ? "key_missing_or_invalid" : newest.status === 403 ? "provider_denied" : null);
  const operator = kind === "key_not_registered" || kind === "key_missing_or_invalid" || kind === "credits" || kind === "workspace_limit" || kind === "provider_denied";
  if (!operator) return { state: "unknown", kind, reason: m?.[2] ?? newest.error_message };
  return { state: "down", kind, reason: m?.[2] ?? newest.error_message };
}

export type AlertAction = "send" | "rearm" | "none";
export function gatewayAlertAction(state: HealthVerdict["state"], alertedAt: string | null): AlertAction {
  if (state === "down") return alertedAt ? "none" : "send";
  if (state === "ok") return alertedAt ? "rearm" : "none";
  return "none";
}

async function recentSamples(): Promise<CallSample[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("ai_call_log")
    .select("status, error_message, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as CallSample[];
}

/** One tiny real call through the normal path (logged like any call). */
export async function runCanary(): Promise<{ status: number; failure: GatewayFailure | null }> {
  const { aiChatCompletions } = await import("@/server/ai-provider.server");
  const res = await aiChatCompletions({
    feature: "triage",
    noFallback: true,
    body: { messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 4 },
    meta: { phase: "gateway_canary", chosenBy: "gateway_canary" },
  } as Parameters<typeof aiChatCompletions>[0]);
  const failure = await readFailure(res);
  try { await res.text(); } catch { /* ignore */ }
  return { status: res.status, failure };
}

export interface GatewayHealthResult extends HealthVerdict { canary: boolean; emailed: boolean; error: string | null }

export async function checkGatewayHealth(origin: string): Promise<GatewayHealthResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: alertRow } = await supabaseAdmin
    .from("balance_alerts").select("alerted_at, updated_at").eq("user_id", GATEWAY_ALERT_ID).maybeSingle();
  const alertedAt = alertRow?.alerted_at ?? null;

  let verdict = verdictFrom(await recentSamples());
  let canary = false;
  const lastCanaryAt = alertRow?.updated_at ? Date.parse(alertRow.updated_at) : 0;
  const mayCanary = !alertedAt || Date.now() - lastCanaryAt >= DOWN_CANARY_INTERVAL_MS;
  if (verdict.state === "unknown" && mayCanary) {
    canary = true;
    const r = await runCanary();
    verdict = r.failure
      ? verdictFrom([{ status: r.status, error_message: failureLabel(r.status, r.failure), created_at: new Date().toISOString() }])
      : { state: "ok", kind: null, reason: null };
  }

  const action = gatewayAlertAction(verdict.state, alertedAt);
  let emailed = false;
  let error: string | null = null;
  let nextAlertedAt = alertedAt;
  if (action === "send") {
    error = await emailOwner(origin, verdict);
    if (!error) { emailed = true; nextAlertedAt = new Date().toISOString(); }
  } else if (action === "rearm") {
    nextAlertedAt = null;
  }
  if (action !== "none" || canary) {
    await supabaseAdmin.from("balance_alerts").upsert(
      { user_id: GATEWAY_ALERT_ID, threshold: 0, alerted_at: nextAlertedAt, last_balance: null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  }
  return { ...verdict, canary, emailed, error };
}

async function emailOwner(origin: string, v: HealthVerdict): Promise<string | null> {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return "BUILDER_SHARED_SECRET not configured";
  const { PARTNER_ALERT_RECIPIENT } = await import("@/server/balance-alert.server");
  const res = await fetch(new URL("/lovable/email/transactional/send", origin).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret },
    body: JSON.stringify({
      templateName: "ai-gateway-down",
      recipientEmail: PARTNER_ALERT_RECIPIENT,
      idempotencyKey: `ai-gateway-down-${new Date().toISOString().slice(0, 13)}`,
      templateData: { kind: v.kind ?? "unknown", reason: v.reason ?? "" },
    }),
  }).catch((e: unknown) => new Response(String(e), { status: 599 }));
  if (!res.ok) return `send ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`;
  return null;
}
