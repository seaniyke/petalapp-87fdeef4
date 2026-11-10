/**
 * Partner API — manage a domain Petal registered for this project.
 *   GET  /api/public/v1/projects/:id/domains/manage?hostname=x.com
 *        → { info, renewal: { periods, priceCents per period }, dns: [...] }
 *   POST /api/public/v1/projects/:id/domains/manage
 *        { hostname, action, ... } where action is one of:
 *        renew_quote {years} · renew {years} · dns_add {name,type,ttl?,values}
 *        dns_replace {name,type,ttl?,values} · dns_delete {name,type,value}
 *        dns_apply · lock {locked} · privacy {on} · auth_code · auto_renew {on}
 * Only domains in purchased_domains for this project (status active) can be managed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, verifyApiCaller } from "@/server/service-api.server";

const Record_ = z.object({
  name: z.string().max(253),
  type: z.string().max(10).transform((t) => t.toUpperCase()),
  ttl: z.number().int().min(1).max(86400).optional(),
  values: z.array(z.string().min(1).max(2048)).min(1).max(20),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("renew_quote"), hostname: z.string(), years: z.number().int().min(1).max(10) }),
  z.object({ action: z.literal("renew"), hostname: z.string(), years: z.number().int().min(1).max(10) }),
  z.object({ action: z.literal("dns_add"), hostname: z.string(), record: Record_ }),
  z.object({ action: z.literal("dns_replace"), hostname: z.string(), record: Record_ }),
  z.object({ action: z.literal("dns_delete"), hostname: z.string(), record: z.object({ name: z.string().max(253), type: z.string().max(10).transform((t) => t.toUpperCase()), value: z.string().min(1).max(2048) }) }),
  z.object({ action: z.literal("dns_apply"), hostname: z.string() }),
  z.object({ action: z.literal("lock"), hostname: z.string(), locked: z.boolean() }),
  z.object({ action: z.literal("privacy"), hostname: z.string(), on: z.boolean() }),
  z.object({ action: z.literal("auth_code"), hostname: z.string() }),
  z.object({ action: z.literal("auto_renew"), hostname: z.string(), on: z.boolean() }),
]);

async function ownedDomain(projectId: string, raw: string) {
  const { normalizeHostname } = await import("@/server/partner-domains.server");
  const hostname = normalizeHostname(raw);
  if (!hostname) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("purchased_domains")
    .select("id, hostname, status, auto_renew, renewal_status, renewal_error, last_renewed_at, term_years")
    .eq("project_id", projectId)
    .eq("hostname", hostname)
    .eq("status", "active")
    .maybeSingle();
  return data
    ? {
        id: data.id as string,
        hostname,
        autoRenew: data.auto_renew as boolean,
        renewalStatus: (data.renewal_status as string | null) ?? null,
        renewalError: (data.renewal_error as string | null) ?? null,
        lastRenewedAt: (data.last_renewed_at as string | null) ?? null,
      }
    : null;
}

function registrarError(e: unknown) {
  const msg = e instanceof Error ? e.message : "registrar_error";
  const code = msg.match(/Dna\.[A-Za-z.]+:[A-Za-z]+:\d+/)?.[0] ?? null;
  return { code, msg };
}

export const Route = createFileRoute("/api/public/v1/projects/$id/domains/manage")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "project_not_found" }, 404);
        const dom = await ownedDomain(params.id, new URL(request.url).searchParams.get("hostname") ?? "");
        if (!dom) return json({ error: "domain_not_found" }, 404);
        const dna = await import("@/server/domain-name-api.server");
        try {
          const [info, terms, dns] = await Promise.all([
            dna.domainInfo(dom.hostname),
            dna.termsFor(dom.hostname),
            dna.listDnsRecords(dom.hostname).catch(() => null),
          ]);
          return json({
            info,
            renewal: {
              autoRenew: dom.autoRenew,
              status: dom.renewalStatus?.startsWith("expiry_notified") ? null : dom.renewalStatus,
              lastError: dom.renewalError,
              lastRenewedAt: dom.lastRenewedAt,
              periods: terms?.renewalPeriods ?? [],
              wholesaleCentsByYears: terms?.renewByPeriod ?? {},
              autoRenewGraceDays: terms?.autoRenewGraceDays ?? null,
              restorableDays: terms?.restorableDays ?? null,
            },
            privacyAvailable: terms?.privacyAvailable ?? false,
            dns,
          });
        } catch (e) {
          const { code, msg } = registrarError(e);
          return json({ error: "registrar_error", code, message: msg }, 502);
        }
      },
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "project_not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_request", issues: parsed.error.issues }, 400);
        const b = parsed.data;
        const dom = await ownedDomain(params.id, b.hostname);
        if (!dom) return json({ error: "domain_not_found" }, 404);
        const dna = await import("@/server/domain-name-api.server");
        const h = dom.hostname;
        try {
          switch (b.action) {
            case "renew_quote": {
              const q = await dna.quoteRenewal(h, b.years);
              return json({ ...q, currency: "USD", reason: q.errorCode ? dna.RENEWAL_ERROR_TEXT[q.errorCode] ?? q.errorCode : null });
            }
            case "renew": {
              const { renewPurchasedDomain } = await import("@/server/domain-renewal.server");
              const r = await renewPurchasedDomain(dom.id, { years: b.years, trigger: "manual" });
              if (r.ok) {
                return json({ success: true, hostname: h, years: r.years, wholesaleCents: r.wholesaleCents, alreadyRenewed: r.alreadyRenewed, expiresAt: r.expiresAt, currency: "USD" });
              }
              const status = r.error === "not_renewable" ? 409 : r.error === "renewal_in_progress" ? 409 : r.error === "registrar_balance_insufficient" ? 402 : 502;
              return json({ error: r.error, code: r.code, reason: r.reason, allowedPeriods: r.allowedYears }, status);
            }
            case "auto_renew": {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              await supabaseAdmin.from("purchased_domains").update({ auto_renew: b.on }).eq("id", dom.id);
              return json({ success: true, autoRenew: b.on });
            }
            case "dns_add":
            case "dns_replace": {
              const bad = dna.validateRecord(b.record);
              if (bad) return json({ error: "invalid_record", reason: bad }, 400);
              if (b.action === "dns_add") await dna.addDnsRecord(h, b.record);
              else await dna.replaceDnsRecord(h, b.record);
              return json({ success: true, dns: await dna.listDnsRecords(h) });
            }
            case "dns_delete":
              await dna.deleteDnsRecord(h, b.record);
              return json({ success: true, dns: await dna.listDnsRecords(h) });
            case "dns_apply":
              return json({ success: true, ...(await dna.applyZone(h)) });
            case "lock":
              await dna.setTransferLock(h, b.locked);
              return json({ success: true, locked: b.locked });
            case "privacy":
              await dna.setPrivacy(h, b.on);
              return json({ success: true, privacy: b.on });
            case "auth_code":
              return json({ success: true, authCode: await dna.regenerateAuthCode(h) });
          }
        } catch (e) {
          const { code, msg } = registrarError(e);
          const balance = /Deposit:10001|Reseller:10001/.test(msg);
          return json({ error: balance ? "registrar_balance_insufficient" : "registrar_error", code, reason: code ? dna.RENEWAL_ERROR_TEXT[code] ?? null : null, message: msg }, balance ? 402 : 502);
        }
      },
    },
  },
});
