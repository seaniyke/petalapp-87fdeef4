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

/* ---------------------------- Multi-year registration price ---------------------------- */

/**
 * Price to register for `years`. The availability search prices only the
 * shortest term (docs), so: that exact search price when `years` matches it,
 * otherwise the catalogue's listed registration price for that term. Premium
 * names are one year only. Never computed by multiplying.
 */
export async function quoteRegistration(
  hostname: string,
  years: number,
  searched?: DomainSearchResult,
): Promise<{ wholesaleCents: number | null; allowedYears: number[]; reason: string | null }> {
  const s = searched ?? (await checkOne(hostname));
  const terms = await termsFor(hostname).catch(() => null);
  const allowed = terms?.registrationPeriods?.length ? terms.registrationPeriods : [s.period ?? 1];
  if (!allowed.includes(years)) return { wholesaleCents: null, allowedYears: allowed, reason: "unsupported_term" };
  if (s.tier === "premium" && years !== 1) return { wholesaleCents: null, allowedYears: [1], reason: "premium_one_year_only" };
  if (years === (s.period ?? 1)) return { wholesaleCents: s.wholesaleCents, allowedYears: allowed, reason: null };
  const listed = terms?.registerByPeriod[years] ?? null;
  return { wholesaleCents: listed, allowedYears: allowed, reason: listed == null ? "no_price" : null };
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
  /** Years to register; defaults to the shortest term the search quoted. */
  years?: number;
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
  const years = args.years ?? recheck.period ?? 1;
  const quoted = years === (recheck.period ?? 1)
    ? recheck.wholesaleCents
    : (await quoteRegistration(args.hostname, years, recheck)).wholesaleCents;
  if (quoted == null) throw new Error("That number of years isn't sold for this ending.");
  if (quoted > Math.ceil(args.expectedWholesaleCents * 1.05)) {
    throw new Error("Price changed since you searched. Please refresh and try again.");
  }

  const contact = parseRegistrantContact(process.env.CLOUDFLARE_REGISTRANT_CONTACT);
  const r = await dnaFetch<{ domainId: string; status: string; expirationDate?: string }>(
    "/domains/register-with-contacts",
    {
      method: "POST",
      body: JSON.stringify({
        domainName: args.hostname,
        period: years,
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

/* ---------------------------- Catalogue (real renewal prices) ---------------------------- */

export type TldTerms = {
  tld: string;
  registrationPeriods: number[];
  renewalPeriods: number[];
  /** 1-year renewal list price in USD cents from the catalogue (our cost basis for renewals). */
  renewCents: number | null;
  /** Price per period exactly as the catalogue lists it. */
  renewByPeriod: Record<number, number>;
  /** Registration list price per period (USD cents). */
  registerByPeriod: Record<number, number>;
  privacyAvailable: boolean;
  autoRenewGraceDays: number | null;
  restorableDays: number | null;
};

let catalogueCache: { at: number; byTld: Map<string, TldTerms> } | null = null;
const CATALOGUE_TTL_MS = 6 * 3600_000;

type CatalogueItem = {
  name: string;
  registrationPeriods?: number[];
  renewalPeriods?: number[];
  isPrivacyAvailable?: boolean;
  autoRenewGracePeriod?: number;
  deletionRestorablePeriod?: number;
  prices?: Array<{
    priceGroup: string;
    renew?: Array<{ period: number; price: number; currency: string }>;
    register?: Array<{ period: number; price: number; currency: string }>;
  }>;
};

export function termsFromCatalogue(item: CatalogueItem, group: string): TldTerms {
  const prices = item.prices?.find((p) => p.priceGroup === group) ?? item.prices?.[0];
  const renewByPeriod: Record<number, number> = {};
  for (const r of prices?.renew ?? []) {
    if (r.currency?.toUpperCase() === "USD") renewByPeriod[r.period] = Math.round(r.price * 100);
  }
  const registerByPeriod: Record<number, number> = {};
  for (const r of prices?.register ?? []) {
    if (r.currency?.toUpperCase() === "USD") registerByPeriod[r.period] = Math.round(r.price * 100);
  }
  return {
    tld: item.name.toLowerCase(),
    registrationPeriods: [...(item.registrationPeriods ?? [])].sort((a, b) => a - b),
    renewalPeriods: [...(item.renewalPeriods ?? [])].sort((a, b) => a - b),
    renewCents: renewByPeriod[1] ?? null,
    renewByPeriod,
    registerByPeriod,
    privacyAvailable: item.isPrivacyAvailable === true,
    autoRenewGraceDays: item.autoRenewGracePeriod ?? null,
    restorableDays: item.deletionRestorablePeriod ?? null,
  };
}

/** Free, unmetered call; cached 6h as the docs recommend. */
export async function loadCatalogue(): Promise<Map<string, TldTerms>> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) return catalogueCache.byTld;
  const me = await dnaFetch<{ resellerGroupName?: string }>("/deposit/accounts/me").catch(() => ({} as { resellerGroupName?: string }));
  const group = me.resellerGroupName || "Reseller";
  const byTld = new Map<string, TldTerms>();
  for (let skip = 0; skip < 5000; skip += 500) {
    const page = await dnaFetch<{ totalCount: number; items: CatalogueItem[] }>(
      `/products/tlds?skipCount=${skip}&maxResultCount=500&currency=USD`,
    );
    for (const it of page.items ?? []) byTld.set(it.name.toLowerCase(), termsFromCatalogue(it, group));
    if (!page.items?.length || skip + 500 >= page.totalCount) break;
  }
  catalogueCache = { at: Date.now(), byTld };
  return byTld;
}

export function tldOf(hostname: string, known: Map<string, unknown>): string {
  const parts = hostname.toLowerCase().split(".");
  for (let i = 1; i < parts.length; i++) {
    const t = parts.slice(i).join(".");
    if (known.has(t)) return t;
  }
  return parts.slice(1).join(".");
}

export async function termsFor(hostname: string): Promise<TldTerms | null> {
  const cat = await loadCatalogue();
  return cat.get(tldOf(hostname, cat)) ?? null;
}

/* ---------------------------- Domain info ---------------------------- */

export type DomainInfo = {
  hostname: string;
  status: string;
  expiresAt: string | null;
  autoRenew: boolean;
  locked: boolean;
  privacy: boolean;
  nameServers: string[];
};

export async function domainInfo(hostname: string): Promise<DomainInfo> {
  const r = await dnaFetch<any>(`/domains/info?domainName=${encodeURIComponent(hostname)}`);
  return {
    hostname,
    status: r.status,
    expiresAt: r.expirationDate ?? null,
    autoRenew: r.renewalMode === "AutoRenew" || r.renewalMode === 1,
    locked: r.lockStatus === true || r.lockStatus === "Locked",
    privacy: r.privacyProtectionStatus === true || r.privacyStatus === true,
    nameServers: Array.isArray(r.nameServers) ? r.nameServers.map((n: any) => (typeof n === "string" ? n : n?.name)).filter(Boolean) : [],
  };
}

/* ---------------------------- Renewal ---------------------------- */

export type RenewalQuote = {
  renewable: boolean;
  period: number;
  wholesaleCents: number | null;
  premium: boolean;
  errorCode: string | null;
  allowedPeriods: number[];
};

/** Dry run (free): /renew/check + catalogue price for the exact period. */
export async function quoteRenewal(hostname: string, period: number): Promise<RenewalQuote> {
  const terms = await termsFor(hostname);
  const allowed = terms?.renewalPeriods ?? [];
  if (allowed.length && !allowed.includes(period)) {
    return { renewable: false, period, wholesaleCents: null, premium: false, errorCode: "Dna.DomainService:Domain:10002", allowedPeriods: allowed };
  }
  const c = await dnaFetch<{
    renewabilityStatus: boolean; errorMessageKey: string | null; isPremium: boolean;
    premiumPrice: number | null; premiumCurrency: string | null;
  }>("/domains/renew/check", { method: "POST", body: JSON.stringify({ domainName: hostname, period }) });
  const wholesale = c.isPremium
    ? (c.premiumPrice != null && c.premiumCurrency?.toUpperCase() === "USD" ? Math.round(c.premiumPrice * 100) : null)
    : (terms?.renewByPeriod[period] ?? null);
  return {
    renewable: c.renewabilityStatus && wholesale != null,
    period,
    wholesaleCents: wholesale,
    premium: c.isPremium,
    errorCode: c.errorMessageKey ?? (wholesale == null ? "no_price" : null),
    allowedPeriods: allowed,
  };
}

export const RENEWAL_ERROR_TEXT: Record<string, string> = {
  "Dna.DomainService:Domain:10020": "Already renewed automatically after expiry.",
  "Dna.DomainService:Domain:10051": "Renewed in the last few days. Try again later.",
  "Dna.DomainService:Domain:10021": "Too early: this ending can only be renewed within 60 days of expiry.",
  "Dna.DomainService:Domain:1028": "That would exceed the longest term allowed. Choose fewer years.",
  "Dna.DomainService:Domain:1016": "That term is too long. Choose fewer years.",
  "Dna.DomainService:Domain:10002": "That number of years isn't sold for this ending.",
  "Dna.DomainService:Domain:10071": "Premium domains renew one year at a time.",
  "Dna.DomainService:Domain:10045": "Renewal is blocked at the registry.",
  "Dna.DomainService:Domain:10018": "This domain can't be renewed in its current state.",
  "Dna.DomainService:Domain:10019": "Registry temporarily unavailable. Try again later.",
  "Dna.DomainService:Deposit:10001": "Registrar balance is too low.",
};

/**
 * Renew and store the registry's expirationDate. On 10020/10051 the renewal
 * already happened, so we read /domains/info instead of retrying (docs).
 * 10059 must never be retried.
 */
export async function renewDomain(hostname: string, period: number): Promise<{ expiresAt: string | null; alreadyRenewed: boolean }> {
  try {
    const r = await dnaFetch<{ expirationDate?: string }>("/domains/renew", {
      method: "POST", body: JSON.stringify({ domainName: hostname, period }),
    });
    return { expiresAt: r.expirationDate ?? null, alreadyRenewed: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/Domain:10020|Domain:10051/.test(msg)) {
      const info = await domainInfo(hostname);
      return { expiresAt: info.expiresAt, alreadyRenewed: true };
    }
    throw e;
  }
}

/* ---------------------------- DNS records ---------------------------- */

export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "CAA", "SRV"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];
export type DnsRecordSet = { name: string; type: string; ttl: number; values: string[] };

export function validateRecord(rec: { name: string; type: string; values: string[] }): string | null {
  const name = rec.name.trim();
  if (!(DNS_RECORD_TYPES as readonly string[]).includes(rec.type)) return "unsupported_type";
  if (!rec.values.length) return "missing_value";
  if (rec.type === "CNAME" && (name === "" || name === "@")) return "cname_at_apex_use_alias";
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  for (const v of rec.values) {
    if (rec.type === "A" && !ipv4.test(v)) return "invalid_ipv4";
    if (rec.type === "AAAA" && !/^[0-9a-f:]+$/i.test(v)) return "invalid_ipv6";
    if ((rec.type === "CNAME" || rec.type === "ALIAS") && ipv4.test(v)) return "hostname_required";
    if (rec.type === "MX" && !/^\d+\s+\S+$/.test(v)) return "mx_format_priority_host";
    if (rec.type === "CAA" && v.trim().split(/\s+/).length < 3) return "caa_format_flag_tag_value";
    if (rec.type === "SRV" && v.trim().split(/\s+/).length !== 4) return "srv_format_priority_weight_port_host";
  }
  return null;
}

function zoneQ(hostname: string) { return `?domainName=${encodeURIComponent(hostname)}`; }

export async function listDnsRecords(hostname: string): Promise<DnsRecordSet[]> {
  const sets = await dnaFetch<Array<{ name: string; type: string; ttl: number; records: Array<{ content: string; disabled: boolean }> }>>(
    `/domains/zones${zoneQ(hostname)}`,
  );
  return (sets ?? []).map((s) => ({
    name: s.name, type: s.type, ttl: s.ttl,
    values: s.records.filter((r) => !r.disabled).map((r) => r.content),
  }));
}

/** POST merges values into the set (docs: adds, never replaces). */
export async function addDnsRecord(hostname: string, rec: { name: string; type: string; ttl?: number; values: string[] }) {
  await dnaFetch(`/domains/zones${zoneQ(hostname)}`, {
    method: "POST",
    body: JSON.stringify({ zoneStruct: { name: rec.name || "@", type: rec.type, ttl: rec.ttl ?? 3600, contents: rec.values } }),
  });
}

/** PUT replaces every value in the set with `values`. */
export async function replaceDnsRecord(hostname: string, rec: { name: string; type: string; ttl?: number; values: string[] }) {
  await dnaFetch(`/domains/zones${zoneQ(hostname)}&recordName=${encodeURIComponent(rec.name || "@")}`, {
    method: "PUT",
    body: JSON.stringify({ zoneStruct: { name: rec.name || "@", type: rec.type, ttl: rec.ttl ?? 3600, contents: rec.values } }),
  });
}

/** DELETE removes one value; name must be inside the zone (full form). */
export async function deleteDnsRecord(hostname: string, rec: { name: string; type: string; value: string }) {
  const short = rec.name.replace(/\.$/, "");
  const full = !short || short === "@" ? hostname : short.endsWith(hostname) ? short : `${short}.${hostname}`;
  await dnaFetch(`/domains/zones${zoneQ(hostname)}`, {
    method: "DELETE",
    body: JSON.stringify({ name: full, recordType: rec.type, record: rec.value }),
  });
}

/** Delegate to DNA name servers so zone records resolve. Idempotent. */
export async function applyZone(hostname: string) {
  return dnaFetch<{ nameServersChanged: boolean; previousNameServers: string[]; currentNameServers: string[] }>(
    `/domains/zones/apply${zoneQ(hostname)}`, { method: "POST" },
  );
}

/* ---------------------------- Lock / privacy / auth code ---------------------------- */

export async function setTransferLock(hostname: string, locked: boolean) {
  await dnaFetch(locked ? "/domains/lock" : "/domains/unlock", { method: "POST", body: JSON.stringify({ domainName: hostname }) });
}

export async function setPrivacy(hostname: string, on: boolean) {
  const terms = await termsFor(hostname);
  if (terms && !terms.privacyAvailable) throw new Error("WHOIS privacy isn't available for this ending.");
  await dnaFetch("/domains/privacy", { method: "POST", body: JSON.stringify({ domainName: hostname, privacyStatus: on }) });
}

/** Regenerates the code; the previous one stops working immediately (docs). */
export async function regenerateAuthCode(hostname: string): Promise<string> {
  const r = await dnaFetch<{ authCode: string }>("/domains/auth", { method: "PUT", body: JSON.stringify({ domainName: hostname }) });
  return r.authCode;
}
