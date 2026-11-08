/**
 * Partner (Custard AI) domain search + purchase.
 *
 * Custard charges its founders itself; Petal bills Custard the wholesale
 * price, so no Petal credits are spent here. Every purchase is recorded in
 * `purchased_domains` under the service account and finishes through the
 * same registration flow as Petal's own purchases.
 *
 * Sandbox (`sandbox: true`) never calls the registrar or writes rows: it
 * returns the same success shape and sends a signed `domain.active` webhook.
 */
import { deliverWebhook, serviceUserId } from "@/server/service-api.server";

export const CUSTARD_DOMAIN_WEBHOOK = "https://custardai.dev/api/public/petal/webhook";
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export type PartnerSearchItem = {
  hostname: string;
  available: boolean;
  priceCents: number | null;
  wholesaleCents: number | null;
  renewalCents: number | null;
  currency: "USD";
  period: number;
  tier: "standard" | "premium" | null;
  reason: string | null;
};

export async function partnerSearch(q: string): Promise<PartnerSearchItem[]> {
  const { searchDomains, loadCatalogue, tldOf } = await import("@/server/domain-name-api.server");
  const [results, catalogue] = await Promise.all([searchDomains(q), loadCatalogue().catch(() => null)]);
  return results.map((r) => ({
    hostname: r.hostname,
    available: r.available,
    priceCents: r.priceCents,
    wholesaleCents: r.wholesaleCents,
    // Renewal is a different price from registration: read it from the
    // registrar's catalogue, never assume it equals the first-year price.
    renewalCents: catalogue?.get(tldOf(r.hostname, catalogue))?.renewCents ?? null,
    currency: "USD",
    period: r.period ?? 1,
    tier: r.tier,
    reason: r.reason,
  }));
}

export function normalizeHostname(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return HOSTNAME_RE.test(h) ? h : null;
}

export type PurchaseOutcome =
  | { status: number; body: Record<string, unknown> };

function domainActivePayload(projectId: string, hostname: string, sandbox: boolean) {
  return {
    event: "domain.active",
    projectId,
    hostname,
    primary: true,
    sslActive: true,
    sandbox,
    timestamp: new Date().toISOString(),
  };
}

export async function partnerPurchase(args: {
  projectId: string;
  hostname: string;
  termYears: number;
  sandbox: boolean;
}): Promise<PurchaseOutcome> {
  const hostname = normalizeHostname(args.hostname);
  if (!hostname) return { status: 400, body: { error: "invalid_name" } };
  if (args.termYears !== 1) return { status: 400, body: { error: "unsupported_term", supported: [1] } };

  const { checkOne } = await import("@/server/domain-name-api.server");

  if (args.sandbox) {
    let quote: Awaited<ReturnType<typeof checkOne>> | null = null;
    try { quote = await checkOne(hostname); } catch { /* price is informational in sandbox */ }
    const expiresAt = new Date(Date.now() + 365 * 86400_000).toISOString();
    void deliverWebhook(CUSTARD_DOMAIN_WEBHOOK, domainActivePayload(args.projectId, hostname, true));
    return {
      status: 201,
      body: {
        success: true, sandbox: true, hostname, status: "active",
        wholesaleCents: quote?.wholesaleCents ?? null, priceCents: quote?.priceCents ?? null,
        currency: "USD", expiresAt, sslStatus: "active",
      },
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const owner = await serviceUserId();

  // Idempotent retry: same hostname already bought for this project.
  const { data: existing } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, project_id, status, wholesale_cost_cents, charged_cents, expires_at, error_message")
    .eq("hostname", hostname)
    .in("status", ["pending_payment", "registering", "polling", "active"])
    .maybeSingle();
  if (existing) {
    if (existing.project_id !== args.projectId) return { status: 409, body: { error: "domain_taken" } };
    return { status: 200, body: purchaseBody(hostname, existing, true) };
  }

  let quote;
  try {
    quote = await checkOne(hostname);
  } catch (e) {
    return { status: 502, body: { error: "registrar_error", message: e instanceof Error ? e.message : "unreachable" } };
  }
  if (!quote.available || quote.wholesaleCents == null) {
    const unsupported = quote.reason && !/exists|notavailable/i.test(quote.reason);
    return { status: unsupported ? 400 : 409, body: { error: unsupported ? "invalid_name" : "domain_taken", reason: quote.reason } };
  }
  if (quote.tier === "premium") return { status: 400, body: { error: "premium_not_supported" } };

  const reference = `cu_${crypto.randomUUID().replace(/-/g, "")}`;
  const { error } = await supabaseAdmin.from("purchased_domains").insert({
    project_id: args.projectId,
    user_id: owner,
    hostname,
    wholesale_cost_cents: quote.wholesaleCents,
    charged_cents: quote.wholesaleCents,
    charged_minor: quote.wholesaleCents,
    currency_code: "USD",
    status: "pending_payment",
    paystack_reference: reference,
  });
  if (error) return { status: 500, body: { error: "record_failed" } };

  const { startDomainRegistration } = await import("@/server/domain-purchase.server");
  await startDomainRegistration({ reference }).catch((e) => console.error("[partner-domain] kickoff", e));

  const { data: after } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, project_id, status, wholesale_cost_cents, charged_cents, expires_at, error_message")
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (!after || after.status === "failed") {
    const msg = after?.error_message ?? "Registration failed";
    const balance = /balance|insufficient|credit/i.test(msg);
    return { status: balance ? 402 : 502, body: { error: balance ? "registrar_balance_insufficient" : "registrar_error", message: msg } };
  }
  return { status: 201, body: purchaseBody(hostname, after, false) };
}

function purchaseBody(
  hostname: string,
  row: { status: string; wholesale_cost_cents: number; expires_at: string | null },
  alreadyExisted: boolean,
) {
  const { status } = row;
  return {
    success: true,
    sandbox: false,
    alreadyExisted,
    hostname,
    status: status === "active" ? "active" : "pending",
    wholesaleCents: row.wholesale_cost_cents,
    currency: "USD",
    expiresAt: row.expires_at,
    sslStatus: status === "active" ? "initializing" : "pending",
  };
}

/** Called once a purchased domain turns active; only API-owned projects notify Custard. */
export async function notifyPartnerDomainActive(projectId: string, hostname: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const owner = await serviceUserId();
    const { data } = await supabaseAdmin.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
    if (!data || data.owner_id !== owner) return;
    await deliverWebhook(CUSTARD_DOMAIN_WEBHOOK, domainActivePayload(projectId, hostname, false));
  } catch (e) {
    console.error("[partner-domain] domain.active webhook failed", hostname, e);
  }
}
