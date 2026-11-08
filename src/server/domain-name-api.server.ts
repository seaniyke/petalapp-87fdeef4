/**
 * Domain Name API (domainresellerapi.com) client — Petal's domain registrar.
 *
 * Replaces the Cloudflare Registrar client. Exposes the same surface
 * (searchDomains / checkOne / registerDomain / registrationStatus /
 * applyMarkup) so the purchase flow did not change shape.
 *
 * Docs: https://www.domainnameapi.com/docs/llms.txt
 *
 * Env (server only):
 *   - DNA_API_BASE_URL  — https://ote.domainresellerapi.com (test, no billing)
 *                         or https://api.domainresellerapi.com (live)
 *   - DNA_API_KEY       — key matching the chosen environment
 *   - DNA_RESELLER_ID   — reseller GUID (same in both environments)
 *   - CLOUDFLARE_REGISTRANT_CONTACT — JSON registrant contact (legacy name kept;
 *     Cloudflare-shaped or Domain-Name-API-shaped both accepted)
 *
 * After registration the domain uses Domain Name API's name servers and we
 * point apex + www at our Cloudflare for SaaS fallback origin; Cloudflare then
 * issues the certificate (custom hostname, HTTP validation).
 */

/** Markup multiplier on the registrar's price to us (cost + 25%). */
export const PRICE_MARKUP = 1.25;

export const SUPPORTED_TLDS = [
  "com", "net", "org", "io", "dev", "app", "co", "ai", "xyz",
  "me", "info", "tech", "online", "site", "store", "blog",
] as const;

export const DNA_NAME_SERVERS = ["tr.apiname.com", "eu.apiname.com"];

function getEnv() {
  const key = process.env.DNA_API_KEY;
  const reseller = process.env.DNA_RESELLER_ID;
  const base = (process.env.DNA_API_BASE_URL || "https://ote.domainresellerapi.com")
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  if (!key || !reseller) throw new Error("Domain registrar not configured");
  return { key, reseller, base };
}

export function isTestEnvironment(): boolean {
  return /ote\./.test(process.env.DNA_API_BASE_URL || "ote.");
}

async function dnaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { key, reseller, base } = getEnv();
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      "X-API-KEY": key,
      __reseller: reseller,
      "X-Correlation-ID": `petal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* plain-text 401s */ }
  // bulk-search answers success:false when some extensions are unsupported but
  // still returns per-domain `infos`; only treat it as an error without them.
  if (!res.ok || (json && json.success === false && !Array.isArray(json) && !Array.isArray(json.infos))) {
    const code = json?.error?.code ?? json?.code;
    const msg = json?.error?.message ?? json?.message ?? json?.reason ?? text.slice(0, 300);
    throw new Error(`Domain registrar error (${res.status})${code ? ` ${code}` : ""}: ${msg || "unknown"}`);
  }
  return json as T;
}

/* ---------------------------- Pricing ---------------------------- */

export function applyMarkup(wholesaleUsdCents: number): number {
  return Math.round(wholesaleUsdCents * PRICE_MARKUP);
}

/* ---------------------------- Search ---------------------------- */

export type DomainTier = "standard" | "premium";

export type DomainSearchResult = {
  hostname: string;
  available: boolean;
  wholesaleCents: number | null;
  priceCents: number | null;
  tier: DomainTier | null;
  reason: string | null;
  /** Registration term (years) the price covers. */
  period?: number;
  documentRequired?: boolean;
};

type DnaInfo = {
  domainName: string;
  status: string;
  reason: string | null;
  isPremium: boolean;
  isDocumentRequired: boolean;
  price: number | null;
  currency: string;
  period: number;
};

export function toResult(d: DnaInfo): DomainSearchResult {
  const usd = d.currency?.toUpperCase() === "USD" && d.price != null;
  const wholesale = usd ? Math.round(Number(d.price) * 100) : null;
  const available = d.status === "AVAILABLE" && !d.isDocumentRequired && wholesale != null;
  return {
    hostname: d.domainName.toLowerCase(),
    available,
    wholesaleCents: wholesale,
    priceCents: wholesale != null ? applyMarkup(wholesale) : null,
    tier: d.isPremium ? "premium" : "standard",
    reason: available
      ? null
      : d.isDocumentRequired
        ? "documents_required"
        : !usd && d.status === "AVAILABLE"
          ? "unsupported_currency"
          : (d.reason ?? d.status.toLowerCase()),
    period: d.period ?? 1,
    documentRequired: d.isDocumentRequired,
  };
}

async function checkDomains(hostnames: string[]): Promise<DomainSearchResult[]> {
  const all: DomainSearchResult[] = [];
  for (let i = 0; i < hostnames.length; i += 30) {
    const chunk = hostnames.slice(i, i + 30);
    try {
      const r = await dnaFetch<{ infos: DnaInfo[] }>("/domains/bulk-search", {
        method: "POST",
        body: JSON.stringify(chunk.map((domainName) => ({ domainName }))),
      });
      for (const d of r.infos ?? []) all.push(toResult(d));
    } catch (e) {
      for (const h of chunk) {
        all.push({
          hostname: h, available: false, wholesaleCents: null, priceCents: null,
          tier: null, reason: e instanceof Error ? e.message : "check_failed",
        });
      }
    }
  }
  return all;
}

export async function searchDomains(query: string): Promise<DomainSearchResult[]> {
  const cleaned = query.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!cleaned) return [];
  const dotIdx = cleaned.indexOf(".");
  let base: string;
  let tlds: readonly string[];
  if (dotIdx === -1) {
    base = cleaned;
    tlds = SUPPORTED_TLDS;
  } else {
    base = cleaned.slice(0, dotIdx);
    const requestedTld = cleaned.slice(dotIdx + 1);
    tlds = [requestedTld, ...SUPPORTED_TLDS.filter((t) => t !== requestedTld)].slice(0, 8);
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(base)) {
    throw new Error("Use letters, numbers, and hyphens only (no spaces or symbols).");
  }
  return checkDomains(tlds.map((t) => `${base}.${t}`));
}

export async function checkOne(hostname: string): Promise<DomainSearchResult> {
  const [r] = await checkDomains([hostname]);
  return r ?? {
    hostname, available: false, wholesaleCents: null, priceCents: null,
    tier: null, reason: "no_response",
  };
}

/* ---------------------------- Contact ---------------------------- */

type DnaContact = {
  contactType: "Registrant";
  firstName: string;
  lastName: string;
  companyName?: string;
  eMail: string;
  address: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phoneCountryCode: string;
  phone: string;
};

/** Accepts Cloudflare-shaped ({email, phone:"+234.80…", postal_info}) or DNA-shaped JSON. */
export function parseRegistrantContact(raw: string | undefined): DnaContact {
  if (!raw) throw new Error("Registrant contact is not configured");
  let c: any;
  try { c = JSON.parse(raw); } catch { throw new Error("Registrant contact is not valid JSON"); }
  if (c.eMail && c.firstName) return { ...c, contactType: "Registrant" };
  const name = String(c.postal_info?.name ?? "").trim();
  const [firstName, ...rest] = name.split(/\s+/);
  const a = c.postal_info?.address ?? {};
  const phoneRaw = String(c.phone ?? "").replace(/[^\d.+]/g, "");
  const m = phoneRaw.match(/^\+?(\d{1,3})\.(\d+)$/);
  return {
    contactType: "Registrant",
    firstName: firstName || "Domain",
    lastName: rest.join(" ") || "Owner",
    companyName: c.postal_info?.organization,
    eMail: c.email,
    address: a.street,
    city: a.city,
    state: a.state,
    postalCode: a.postal_code,
    country: String(a.country_code ?? "").toUpperCase(),
    phoneCountryCode: m ? m[1] : "",
    phone: m ? m[2] : phoneRaw.replace(/\D/g, ""),
  };
}

/* ---------------------------- Registration ---------------------------- */

export type RegistrationState = "in_progress" | "succeeded" | "failed" | "action_required" | "blocked";

export type RegistrationWorkflow = {
  domain_name: string;
  state: RegistrationState;
  completed: boolean;
  context?: {
    registration?: {
      domain_name: string;
      status: string;
      created_at?: string;
      expires_at?: string;
      auto_renew?: boolean;
    };
  };
  links?: { resource?: string };
  error?: { code?: string; message?: string };
};

/** Map a Domain Name API status name to our workflow state. */
export function mapStatus(status: string | undefined): RegistrationState {
  const s = String(status ?? "").toLowerCase();
  if (s === "active") return "succeeded";
  if (s.includes("document")) return "action_required";
  if (s.startsWith("waiting") || s.startsWith("pending") || s === "") return "in_progress";
  if (s.includes("delete") || s.includes("cancel") || s.includes("fail")) return "failed";
  return "blocked";
}

export async function registerDomain(args: {
  hostname: string;
  expectedWholesaleCents: number;
}): Promise<RegistrationWorkflow> {
  const recheck = await checkOne(args.hostname);
  if (!recheck.available) {
    throw new Error(
      !recheck.reason || /exists|notavailable/i.test(recheck.reason)
        ? "That domain was just taken. Please pick another."
        : `Domain not registrable: ${recheck.reason}`,
    );
  }
  if (recheck.wholesaleCents == null) throw new Error("Couldn't confirm the price. Please try again.");
  if (recheck.tier === "premium") throw new Error("Premium domains aren't supported yet. Pick another name.");
  if (recheck.wholesaleCents > Math.ceil(args.expectedWholesaleCents * 1.05)) {
    throw new Error("Price changed since you searched. Please refresh and try again.");
  }

  const contact = parseRegistrantContact(process.env.CLOUDFLARE_REGISTRANT_CONTACT);
  const r = await dnaFetch<{ domainId: string; status: string; expirationDate?: string }>(
    "/domains/register-with-contacts",
    {
      method: "POST",
      body: JSON.stringify({
        domainName: args.hostname,
        period: recheck.period ?? 1,
        nameServers: DNA_NAME_SERVERS,
        contacts: [contact],
      }),
    },
  );
  const state = mapStatus(r.status);
  return {
    domain_name: args.hostname,
    state,
    completed: state !== "in_progress",
    context: {
      registration: {
        domain_name: args.hostname,
        status: r.status,
        created_at: new Date().toISOString(),
        expires_at: r.expirationDate,
      },
    },
    links: { resource: r.domainId },
  };
}

export async function registrationStatus(hostname: string): Promise<RegistrationWorkflow> {
  const r = await dnaFetch<{
    status: string; statusReason?: string; startDate?: string;
    expirationDate?: string; renewalMode?: string | number;
  }>(`/domains/info?domainName=${encodeURIComponent(hostname)}`);
  const state = mapStatus(r.status);
  return {
    domain_name: hostname,
    state,
    completed: state !== "in_progress",
    context: {
      registration: {
        domain_name: hostname,
        status: r.status,
        created_at: r.startDate,
        expires_at: r.expirationDate,
        auto_renew: r.renewalMode === "AutoRenew" || r.renewalMode === 1,
      },
    },
    error: state === "succeeded" || state === "in_progress"
      ? undefined
      : { message: `Registration ${r.status}${r.statusReason && r.statusReason !== "None" ? ` (${r.statusReason})` : ""}` },
  };
}

/* ---------------------------- DNS ---------------------------- */

async function resolveA(host: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { accept: "application/dns-json" },
  });
  const j = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  return (j.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

/**
 * Point the domain at Petal's edge: apex A → fallback origin IPs (a CNAME is
 * not allowed at the apex), www CNAME → fallback origin. Zones API is
 * unavailable in the test environment (HTTP 500 there), so we skip it.
 */
export async function pointDomainAtPetal(hostname: string): Promise<{ skipped: boolean }> {
  if (isTestEnvironment()) return { skipped: true };
  const fallback = process.env.CLOUDFLARE_FALLBACK_ORIGIN || "fallback.buildwithpetal.com";
  const ips = await resolveA(fallback);
  if (ips.length === 0) throw new Error(`Could not resolve ${fallback}`);
  const q = `?domainName=${encodeURIComponent(hostname)}`;
  await dnaFetch(`/domains/zones${q}`, {
    method: "POST",
    body: JSON.stringify({ zoneStruct: { name: "@", type: "A", ttl: 300, contents: ips } }),
  });
  await dnaFetch(`/domains/zones${q}`, {
    method: "POST",
    body: JSON.stringify({ zoneStruct: { name: "www", type: "CNAME", ttl: 300, contents: [fallback] } }),
  });
  return { skipped: false };
}
