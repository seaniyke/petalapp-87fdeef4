/**
 * Cloudflare Registrar API client (beta).
 *
 * Powers Petal's "Buy a domain" flow. Cloudflare resells domains at wholesale
 * cost (no markup). We charge the user wholesale × 1.25 — the 25% covers
 * payment processing, support, and our infra around DNS/SSL provisioning.
 *
 * Real endpoints (as of the public beta — Oct 2025):
 *   - GET  /accounts/{id}/registrar/domain-search?query=...
 *   - POST /accounts/{id}/registrar/domain-check  body: { domains: [...] }  (max 20)
 *   - POST /accounts/{id}/registrar/registrations body: { domain_name, contacts? }
 *   - GET  /accounts/{id}/registrar/registrations/{name}/registration-status
 *   - GET  /accounts/{id}/registrar/registrations/{name}
 *
 * Pre-flight requirements on the Cloudflare account:
 *   1. A billing profile with a default payment method.
 *   2. A default registrant contact saved on the account.
 *   3. Acceptance of the Domain Registration Agreement.
 * If any are missing, registrations() will fail and we surface the error.
 *
 * Required env:
 *   - CLOUDFLARE_API_TOKEN     — token with Account/Registrar Domains: Edit
 *   - CLOUDFLARE_ACCOUNT_ID    — the account that owns/will own the domain
 *
 * Optional env:
 *   - CLOUDFLARE_REGISTRANT_CONTACT — JSON; if set, sent inline; else CF uses
 *     the account default (recommended).
 *
 * Docs: https://developers.cloudflare.com/registrar/registrar-api/
 */

const CF_API = "https://api.cloudflare.com/client/v4";

/** Markup multiplier on Cloudflare's wholesale price (cost + 25%). */
export const PRICE_MARKUP = 1.25;

/** TLDs we offer in the search UI. Cloudflare's API beta supports a subset
 *  of dashboard-supported TLDs; non-supported ones return registrable: false
 *  with reason "extension_not_supported_via_api" and we hide them.
 */
export const SUPPORTED_TLDS = [
  "com", "net", "org", "io", "dev", "app", "co", "ai", "xyz",
  "me", "info", "tech", "online", "site", "store", "blog",
] as const;

/** Inline contact shape — matches Cloudflare's nested format. */
export type RegistrantContact = {
  email: string;
  phone: string;
  postal_info: {
    name: string;
    organization?: string;
    address: {
      street: string;
      city: string;
      state?: string;
      postal_code: string;
      country_code: string; // 2-letter ISO
    };
  };
};

type CfEnvelope<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
};

function getEnv() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("Cloudflare Registrar not configured");
  }
  return { token, accountId };
}

/** Returns the registrant contact override, or null to let CF use the
 *  account default (recommended path). */
function getRegistrantContactOrNull(): RegistrantContact | null {
  const raw = process.env.CLOUDFLARE_REGISTRANT_CONTACT;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistrantContact;
  } catch {
    throw new Error("CLOUDFLARE_REGISTRANT_CONTACT is not valid JSON");
  }
}

async function cfFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ result: T; status: number }> {
  const { token } = getEnv();
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || !json?.success) {
    const msg =
      json?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `Cloudflare Registrar error (${res.status})`;
    throw new Error(msg);
  }
  return { result: json.result, status: res.status };
}

/* ---------------------------- Pricing ---------------------------- */

/** Apply our markup to Cloudflare's wholesale price. Returns USD cents. */
export function applyMarkup(wholesaleUsdCents: number): number {
  return Math.round(wholesaleUsdCents * PRICE_MARKUP);
}

/* ---------------------------- Search / Check ---------------------------- */

export type DomainTier = "standard" | "premium";

export type DomainSearchResult = {
  hostname: string;
  available: boolean;
  /** Wholesale price in USD cents for 1 year. null if unavailable / unknown. */
  wholesaleCents: number | null;
  /** What the user pays (wholesale × 1.25), USD cents. null if unavailable. */
  priceCents: number | null;
  tier: DomainTier | null;
  /** When `available` is false, why. */
  reason: string | null;
};

type CfCheckDomain = {
  name: string;
  registrable: boolean;
  tier?: DomainTier;
  pricing?: {
    currency: "USD";
    registration_cost: string | number;
    renewal_cost?: string | number;
  };
  reason?: string;
};

function toResult(d: CfCheckDomain): DomainSearchResult {
  const wholesale = d.pricing?.registration_cost != null
    ? Math.round(Number(d.pricing.registration_cost) * 100)
    : null;
  return {
    hostname: d.name,
    available: !!d.registrable,
    wholesaleCents: wholesale,
    priceCents: wholesale != null ? applyMarkup(wholesale) : null,
    tier: d.tier ?? null,
    reason: d.reason ?? null,
  };
}

/**
 * Real-time, authoritative availability + price check. Up to 20 hostnames
 * per request. Use this immediately before calling registerDomain().
 */
async function checkDomains(hostnames: string[]): Promise<DomainSearchResult[]> {
  if (hostnames.length === 0) return [];
  const { accountId } = getEnv();
  // Hard cap at 20 per CF docs — chunk if caller passes more.
  const chunks: string[][] = [];
  for (let i = 0; i < hostnames.length; i += 20) {
    chunks.push(hostnames.slice(i, i + 20));
  }
  const all: DomainSearchResult[] = [];
  for (const chunk of chunks) {
    try {
      const { result } = await cfFetch<{ domains: CfCheckDomain[] }>(
        `/accounts/${accountId}/registrar/domain-check`,
        { method: "POST", body: JSON.stringify({ domains: chunk }) },
      );
      for (const d of result.domains ?? []) all.push(toResult(d));
    } catch (e) {
      // Surface as "unknown" rather than killing the whole search.
      for (const h of chunk) {
        all.push({
          hostname: h,
          available: false,
          wholesaleCents: null,
          priceCents: null,
          tier: null,
          reason: e instanceof Error ? e.message : "check_failed",
        });
      }
    }
  }
  return all;
}

/**
 * Search a base name. If the user typed a bare label ("acme") we check it
 * across SUPPORTED_TLDs. If they typed a hostname ("acme.com") we check that
 * exact hostname plus a few popular alternatives.
 */
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

  const hostnames = tlds.map((t) => `${base}.${t}`);
  return checkDomains(hostnames);
}

/** Single-hostname check — used right before purchase to re-verify. */
export async function checkOne(hostname: string): Promise<DomainSearchResult> {
  const [r] = await checkDomains([hostname]);
  return r ?? {
    hostname,
    available: false,
    wholesaleCents: null,
    priceCents: null,
    tier: null,
    reason: "no_response",
  };
}

/* ---------------------------- Registration ---------------------------- */

export type CfRegistrationState =
  | "in_progress"
  | "succeeded"
  | "failed"
  | "action_required"
  | "blocked";

export type CfRegistrationWorkflow = {
  domain_name: string;
  state: CfRegistrationState;
  completed: boolean;
  created_at?: string;
  updated_at?: string;
  context?: {
    registration?: {
      domain_name: string;
      status: string;
      created_at?: string;
      expires_at?: string;
      auto_renew?: boolean;
      privacy_mode?: string;
      locked?: boolean;
    };
  };
  links?: { self?: string; resource?: string };
  error?: { code?: string; message?: string };
};

/**
 * Kick off a registration. Returns immediately with the workflow state —
 * the caller MUST poll registrationStatus() until `completed === true`
 * before treating the domain as live.
 *
 * We always send `Prefer: respond-async` so we don't hold the webhook
 * (or background worker) for the full 10s wait window.
 *
 * Pre-condition: caller has just run checkOne() and confirmed the price
 * matches `expectedWholesaleCents` within tolerance.
 */
export async function registerDomain(args: {
  hostname: string;
  expectedWholesaleCents: number;
}): Promise<CfRegistrationWorkflow> {
  const { accountId } = getEnv();

  // Re-check availability + price right before purchase.
  const recheck = await checkOne(args.hostname);
  if (!recheck.available) {
    throw new Error(
      recheck.reason === "domain_unavailable" || !recheck.reason
        ? "That domain was just taken. Please pick another."
        : `Domain not registrable: ${recheck.reason}`,
    );
  }
  if (recheck.wholesaleCents == null) {
    throw new Error("Couldn't confirm the price. Please try again.");
  }
  // Block premiums for now — they need explicit fee acknowledgement.
  if (recheck.tier === "premium") {
    throw new Error("Premium domains aren't supported yet. Pick another name.");
  }
  // Allow up to 5% upward drift before bailing.
  const ceiling = Math.ceil(args.expectedWholesaleCents * 1.05);
  if (recheck.wholesaleCents > ceiling) {
    throw new Error("Price changed since you searched. Please refresh and try again.");
  }

  const contact = getRegistrantContactOrNull();
  const body: Record<string, unknown> = { domain_name: args.hostname };
  if (contact) body.contacts = { registrant: contact };

  const { result } = await cfFetch<CfRegistrationWorkflow>(
    `/accounts/${accountId}/registrar/registrations`,
    {
      method: "POST",
      headers: { Prefer: "respond-async" },
      body: JSON.stringify(body),
    },
  );
  return result;
}

/** Poll the workflow until terminal. Returns the latest workflow snapshot. */
export async function registrationStatus(
  hostname: string,
): Promise<CfRegistrationWorkflow> {
  const { accountId } = getEnv();
  const { result } = await cfFetch<CfRegistrationWorkflow>(
    `/accounts/${accountId}/registrar/registrations/${encodeURIComponent(hostname)}/registration-status`,
  );
  return result;
}

/** Final registration resource (after `state: succeeded`). */
export type CfRegistrationResource = {
  domain_name: string;
  status: string;
  created_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  privacy_mode?: string;
  locked?: boolean;
};

export async function getRegistration(
  hostname: string,
): Promise<CfRegistrationResource> {
  const { accountId } = getEnv();
  const { result } = await cfFetch<CfRegistrationResource>(
    `/accounts/${accountId}/registrar/registrations/${encodeURIComponent(hostname)}`,
  );
  return result;
}
