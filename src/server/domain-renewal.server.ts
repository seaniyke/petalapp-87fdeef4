/**
 * Domain renewals — automatic (daily job) and on request.
 *
 * Rules (Domain Name API docs, Renew a domain):
 *   - Price: free /renew/check, then the catalogue's renewal price for that
 *     exact term (or the premium price /renew/check returns). Never assumed.
 *   - Store the expirationDate the registrar returns; never add years ourselves.
 *   - 10020/10051 mean it was already renewed: sync from /domains/info, no charge.
 *   - Renewals are accepted on every extension within 60 days of expiry, so the
 *     job starts AUTO_RENEW_WINDOW_DAYS (30) before expiry and retries daily.
 *
 * Who pays:
 *   - Partner (Custard) projects, owned by the service account: billed at the
 *     registrar's renewal price, reported in the signed `domain.renewed` webhook.
 *   - Petal customers: credits for renewal price + markup, taken before renewing
 *     and returned if the registrar refuses.
 * Every attempt is one row in `domain_renewals`; a partial unique index allows
 * only one successful renewal per expiry date, so a domain is never renewed twice.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyMarkup,
  quoteRenewal,
  renewDomain,
  termsFor,
  RENEWAL_ERROR_TEXT,
} from "@/server/domain-name-api.server";

export const AUTO_RENEW_WINDOW_DAYS = 30;
const DAY = 86400_000;

type DomainRow = {
  id: string;
  project_id: string;
  user_id: string;
  hostname: string;
  expires_at: string | null;
  auto_renew: boolean;
  renewal_status: string | null;
};

export type RenewalResult =
  | { ok: true; hostname: string; years: number; wholesaleCents: number; chargedCents: number; credits: number | null; expiresAt: string | null; alreadyRenewed: boolean }
  | { ok: false; hostname: string; error: string; code: string | null; reason: string | null; allowedYears?: number[] };

/** True when the domain belongs to a partner (service-account) project. */
async function isPartnerDomain(row: DomainRow): Promise<boolean> {
  const { serviceUserId } = await import("@/server/service-api.server");
  try {
    return row.user_id === (await serviceUserId());
  } catch {
    return false;
  }
}

/** Is it time to auto-renew? Pure, so it can be tested. */
export function isRenewalDue(expiresAt: string | null, now: number, windowDays = AUTO_RENEW_WINDOW_DAYS): boolean {
  if (!expiresAt) return false;
  const left = new Date(expiresAt).getTime() - now;
  return left <= windowDays * DAY;
}

async function notifyPartner(event: string, row: DomainRow, extra: Record<string, unknown>) {
  const { deliverWebhook } = await import("@/server/service-api.server");
  const { CUSTARD_DOMAIN_WEBHOOK } = await import("@/server/partner-domains.server");
  await deliverWebhook(CUSTARD_DOMAIN_WEBHOOK, {
    event,
    projectId: row.project_id,
    hostname: row.hostname,
    timestamp: new Date().toISOString(),
    ...extra,
  }).catch((e) => console.error("[domain-renewal] webhook failed", event, row.hostname, e));
}

/** Claim the row so two runs can't renew the same domain at once. */
async function claim(row: DomainRow): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("purchased_domains")
    .update({ renewal_status: "renewing", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .or(`renewal_status.is.null,renewal_status.neq.renewing,updated_at.lt.${staleBefore}`)
    .select("id");
  return (data?.length ?? 0) > 0;
}

export async function renewPurchasedDomain(
  domainId: string,
  opts: { years?: number; trigger: "auto" | "manual" },
): Promise<RenewalResult> {
  const { data: row } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, project_id, user_id, hostname, expires_at, auto_renew, renewal_status")
    .eq("id", domainId)
    .eq("status", "active")
    .maybeSingle<DomainRow>();
  if (!row) return { ok: false, hostname: "", error: "domain_not_found", code: null, reason: null };
  if (!(await claim(row))) return { ok: false, hostname: row.hostname, error: "renewal_in_progress", code: null, reason: null };

  const partner = await isPartnerDomain(row);
  const log = async (fields: Record<string, unknown>) => {
    await supabaseAdmin.from("domain_renewals").insert({
      purchased_domain_id: row.id,
      hostname: row.hostname,
      payer: partner ? "partner" : "customer",
      trigger: opts.trigger,
      prior_expires_at: row.expires_at,
      ...fields,
    } as never);
  };
  const finish = async (status: string, error: string | null, expiresAt?: string | null) => {
    await supabaseAdmin
      .from("purchased_domains")
      .update({
        renewal_status: status,
        renewal_error: error,
        ...(expiresAt ? { expires_at: expiresAt, last_renewed_at: new Date().toISOString() } : {}),
      })
      .eq("id", row.id);
  };

  // 1. Term + price, from the registrar only.
  let years = opts.years;
  if (!years) {
    const terms = await termsFor(row.hostname).catch(() => null);
    years = terms?.renewalPeriods[0] ?? 1;
  }
  let quote;
  try {
    quote = await quoteRenewal(row.hostname, years);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "registrar_error";
    await log({ years, status: "failed", error_message: msg });
    await finish("failed", msg);
    return { ok: false, hostname: row.hostname, error: "registrar_error", code: null, reason: msg };
  }
  if (!quote.renewable || quote.wholesaleCents == null) {
    const reason = quote.errorCode ? RENEWAL_ERROR_TEXT[quote.errorCode] ?? quote.errorCode : "No renewal price available.";
    await log({ years, status: "refused", error_code: quote.errorCode, error_message: reason });
    await finish("refused", reason);
    if (partner) await notifyPartner("domain.renewal_failed", row, { years, code: quote.errorCode, reason, expiresAt: row.expires_at });
    return { ok: false, hostname: row.hostname, error: "not_renewable", code: quote.errorCode, reason, allowedYears: quote.allowedPeriods };
  }
  const wholesale = quote.wholesaleCents;

  // 2. Take payment (customers only), before spending registrar balance.
  let credits: number | null = null;
  let ledgerId: string | null = null;
  const chargedCents = partner ? wholesale : applyMarkup(wholesale);
  if (!partner) {
    const { economicsValue } = await import("@/server/economics-config.server");
    const { spendCredit } = await import("@/server/credits.server");
    const { creditsForUsdCents } = await import("@/server/domain-credits");
    credits = creditsForUsdCents(chargedCents, await economicsValue("credit_retail_usd_cents"));
    const spent = await spendCredit({
      userId: row.user_id,
      amount: credits,
      reason: "domain_purchase",
      projectId: row.project_id,
      metadata: { kind: "renewal", hostname: row.hostname, years, usd_cents: chargedCents },
    });
    if (!spent.ok) {
      const reason = spent.reason === "insufficient_credits" ? "Not enough credits to renew." : "Couldn't take payment.";
      await log({ years, wholesale_cents: wholesale, charged_cents: chargedCents, credits, status: "payment_failed", error_message: reason });
      await finish("payment_failed", reason);
      return { ok: false, hostname: row.hostname, error: spent.reason ?? "payment_failed", code: null, reason };
    }
    ledgerId = spent.ledgerId;
  }

  // 3. Renew at the registrar.
  try {
    const r = await renewDomain(row.hostname, years);
    if (r.alreadyRenewed && ledgerId) {
      const { refundCredit } = await import("@/server/credits.server");
      await refundCredit({ userId: row.user_id, ledgerId, reason: "refund", metadata: { kind: "renewal_already_done" } });
    }
    const paid = r.alreadyRenewed ? 0 : chargedCents;
    await log({
      years, new_expires_at: r.expiresAt, wholesale_cents: r.alreadyRenewed ? 0 : wholesale,
      charged_cents: paid, credits: r.alreadyRenewed ? 0 : credits, credit_ledger_id: ledgerId,
      status: r.alreadyRenewed ? "already_renewed" : "succeeded",
    });
    await finish("renewed", null, r.expiresAt);
    if (partner) {
      await notifyPartner("domain.renewed", row, {
        years, wholesaleCents: r.alreadyRenewed ? 0 : wholesale, currency: "USD",
        alreadyRenewed: r.alreadyRenewed, expiresAt: r.expiresAt, trigger: opts.trigger,
      });
    }
    return {
      ok: true, hostname: row.hostname, years, wholesaleCents: r.alreadyRenewed ? 0 : wholesale,
      chargedCents: paid, credits: r.alreadyRenewed ? 0 : credits, expiresAt: r.expiresAt, alreadyRenewed: r.alreadyRenewed,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "registrar_error";
    const code = msg.match(/Dna\.[A-Za-z.]+:[A-Za-z]+:\d+/)?.[0] ?? null;
    // 10059: renewed at the registry but not recorded — never retry, keep the charge, flag it.
    const neverRetry = code === "Dna.DomainService:Domain:10059";
    if (ledgerId && !neverRetry) {
      const { refundCredit } = await import("@/server/credits.server");
      await refundCredit({ userId: row.user_id, ledgerId, reason: "refund", metadata: { kind: "renewal_failed" } });
    }
    const reason = code ? RENEWAL_ERROR_TEXT[code] ?? msg : msg;
    await log({ years, wholesale_cents: wholesale, charged_cents: chargedCents, credits, credit_ledger_id: ledgerId, status: neverRetry ? "needs_support" : "failed", error_code: code, error_message: msg });
    await finish(neverRetry ? "needs_support" : "failed", reason);
    if (partner) await notifyPartner("domain.renewal_failed", row, { years, code, reason, expiresAt: row.expires_at });
    const balance = /Deposit:10001|Reseller:10001/.test(msg);
    return { ok: false, hostname: row.hostname, error: balance ? "registrar_balance_insufficient" : "registrar_error", code, reason };
  }
}

/**
 * Daily job: renew every auto-renew domain inside the window; tell partners
 * once about domains that will lapse because auto-renew is off.
 */
export async function runDueRenewals(now = Date.now()) {
  const until = new Date(now + AUTO_RENEW_WINDOW_DAYS * DAY).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, project_id, user_id, hostname, expires_at, auto_renew, renewal_status")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", until)
    .limit(200);
  const out = { checked: rows?.length ?? 0, renewed: 0, failed: 0, notified: 0, skipped: 0 };
  for (const row of (rows ?? []) as DomainRow[]) {
    if (row.renewal_status === "needs_support") { out.skipped++; continue; }
    if (!row.auto_renew) {
      const marker = `expiry_notified:${row.expires_at}`;
      if (row.renewal_status !== marker && (await isPartnerDomain(row))) {
        await notifyPartner("domain.expiring", row, { expiresAt: row.expires_at, autoRenew: false });
        await supabaseAdmin.from("purchased_domains").update({ renewal_status: marker }).eq("id", row.id);
        out.notified++;
      } else out.skipped++;
      continue;
    }
    const r = await renewPurchasedDomain(row.id, { trigger: "auto" });
    if (r.ok) out.renewed++; else out.failed++;
  }
  return out;
}
