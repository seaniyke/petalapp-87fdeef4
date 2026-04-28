/**
 * Cloudflare Registrar API client.
 *
 * Powers Petal's "Buy a domain" flow. Cloudflare resells domains at wholesale
 * cost (no markup). We charge the user wholesale × 1.25 — the 25% covers
 * payment processing, support, and our infra around DNS/SSL provisioning.
 *
 * Flow:
 *   1. searchDomains(query) — check availability + wholesale price for a name
 *      across common TLDs.
 *   2. registerDomain(hostname) — after Paystack confirms payment, register
 *      the domain on the user's behalf using the stored registrant contact.
 *
 * Required env:
 *   - CLOUDFLARE_API_TOKEN — scoped token with Account/Registrar Domains: Edit
 *   - CLOUDFLARE_ACCOUNT_ID — the account that owns/will own the domain
 *   - CLOUDFLARE_REGISTRANT_CONTACT — JSON blob with WHOIS contact details
 *
 * Docs: https://developers.cloudflare.com/api/operations/registrar-domains-list-domains
 */

const CF_API = "https://api.cloudflare.com/client/v4";

/** Markup multiplier on Cloudflare's wholesale price (cost + 25%). */
export const PRICE_MARKUP = 1.25;

/** TLDs we offer in the search UI. Cloudflare supports many more — start narrow. */
export const SUPPORTED_TLDS = [
  "com", "net", "org", "io", "dev", "app", "co", "ai", "xyz",
  "me", "info", "tech", "online", "site", "store", "blog",
] as const;

export type RegistrantContact = {
  first_name: string;
  last_name: string;
  organization?: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state?: string;
  zip: string;
  country: string; // 2-letter ISO
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

function getRegistrantContact(): RegistrantContact {
  const raw = process.env.CLOUDFLARE_REGISTRANT_CONTACT;
  if (!raw) throw new Error("CLOUDFLARE_REGISTRANT_CONTACT not configured");
  try {
    return JSON.parse(raw) as RegistrantContact;
  } catch {
    throw new Error("CLOUDFLARE_REGISTRANT_CONTACT is not valid JSON");
  }
}

async function cfFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  return json.result;
}

/* ---------------------------- Pricing ---------------------------- */

/**
 * Apply our markup to Cloudflare's wholesale price.
 * Returns USD cents (rounded to nearest cent).
 */
export function applyMarkup(wholesaleUsdCents: number): number {
  return Math.round(wholesaleUsdCents * PRICE_MARKUP);
}

/* ---------------------------- Search ---------------------------- */

export type DomainSearchResult = {
  hostname: string;
  available: boolean;
  /** Wholesale price in USD cents for 1 year. null if unavailable / unknown. */
  wholesaleCents: number | null;
  /** What the user pays (wholesale × 1.25), USD cents. null if unavailable. */
  priceCents: number | null;
};

type CfAvailabilityResult = {
  available: boolean;
  premium?: boolean;
  /** Cloudflare returns price as a string like "9.15" (USD per year). */
  price?: string | number;
};

/**
 * Check a single hostname's availability + wholesale price via the
 * Registrar's domain check endpoint.
 *
 * NOTE: Cloudflare's exact endpoint shape has changed over time; this targets
 * the current `/accounts/:id/registrar/domains/{hostname}/check` resource.
 * If it returns an error we surface it rather than silently mocking a price.
 */
async function checkOne(hostname: string): Promise<DomainSearchResult> {
  const { accountId } = getEnv();
  try {
    const r = await cfFetch<CfAvailabilityResult>(
      `/accounts/${accountId}/registrar/domains/${encodeURIComponent(hostname)}/check`,
    );
    const wholesale = r.price != null
      ? Math.round(Number(r.price) * 100)
      : null;
    return {
      hostname,
      available: !!r.available,
      wholesaleCents: wholesale,
      priceCents: wholesale != null ? applyMarkup(wholesale) : null,
    };
  } catch (e) {
    // Treat errors as "unknown availability" rather than failing the whole search.
    return {
      hostname,
      available: false,
      wholesaleCents: null,
      priceCents: null,
    };
  }
}

/**
 * Search a base name across all SUPPORTED_TLDs in parallel.
 * `query` may be a bare label ("acme") or a full hostname ("acme.com").
 * If a TLD is included in the query we search ONLY that TLD plus a few
 * popular alternatives.
 */
export async function searchDomains(query: string): Promise<DomainSearchResult[]> {
  const cleaned = query.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
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
    // Search the requested TLD first, then a curated set of alternatives.
    tlds = [requestedTld, ...SUPPORTED_TLDS.filter((t) => t !== requestedTld)].slice(0, 8);
  }

  // Validate the base label: 1-63 chars, alnum/hyphen, no leading/trailing hyphen.
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(base)) {
    throw new Error("Use letters, numbers, and hyphens only (no spaces or symbols).");
  }

  const hostnames = tlds.map((t) => `${base}.${t}`);
  return Promise.all(hostnames.map(checkOne));
}

/* ---------------------------- Registration ---------------------------- */

export type RegisteredDomain = {
  id: string;
  name: string;
  expires_at?: string;
  auto_renew?: boolean;
};

/**
 * Register a domain on the user's behalf using our stored registrant contact.
 * Returns Cloudflare's domain record on success.
 *
 * Pre-condition: `wholesaleCents` matches what `checkOne()` returned for the
 * same hostname — we re-verify availability before charging Cloudflare to
 * guard against price drift between search and purchase.
 */
export async function registerDomain(args: {
  hostname: string;
  expectedWholesaleCents: number;
}): Promise<RegisteredDomain> {
  const { accountId } = getEnv();
  const contact = getRegistrantContact();

  // Re-check availability + price right before purchase.
  const recheck = await checkOne(args.hostname);
  if (!recheck.available) {
    throw new Error("That domain was just taken. Please pick another.");
  }
  if (recheck.wholesaleCents == null) {
    throw new Error("Couldn't confirm the price. Please try again.");
  }
  // Allow up to 5% upward drift before bailing.
  const ceiling = Math.ceil(args.expectedWholesaleCents * 1.05);
  if (recheck.wholesaleCents > ceiling) {
    throw new Error(
      `Price changed since you searched. Please refresh and try again.`,
    );
  }

  return cfFetch<RegisteredDomain>(
    `/accounts/${accountId}/registrar/domains/${encodeURIComponent(args.hostname)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: args.hostname,
        privacy: true,
        auto_renew: true,
        locked: true,
        registrant_contact: contact,
        admin_contact: contact,
        tech_contact: contact,
        billing_contact: contact,
      }),
    },
  );
}
