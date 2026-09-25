/**
 * Web Intelligence — Firecrawl as an INFORMATION SOURCE ONLY.
 *
 * One entry point (gatherWebIntel) called once per generation turn, before
 * the context budget. It never writes files, never calls an AI model, never
 * plans, never repairs. Its only output is a bounded, sanitized text block
 * that joins the existing generation context.
 *
 * Credentials are read from server env inside the call (never module scope)
 * and never returned, logged or streamed.
 */
import { isIP } from "node:net";

// ---------------------------------------------------------------- limits
/** All limits in one place. Override with WEB_INTEL_* env vars (server only). */
export function webIntelLimits() {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    maxPages: n("WEB_INTEL_MAX_PAGES", 4), // pages scraped (incl. the given URL)
    maxMapLinks: n("WEB_INTEL_MAX_MAP_LINKS", 50), // URLs considered from map
    requestTimeoutMs: n("WEB_INTEL_REQUEST_TIMEOUT_MS", 20_000),
    totalTimeoutMs: n("WEB_INTEL_TOTAL_TIMEOUT_MS", 45_000),
    maxPageChars: n("WEB_INTEL_MAX_PAGE_CHARS", 60_000), // raw content accepted per page
    maxContextChars: n("WEB_INTEL_MAX_CONTEXT_CHARS", 6_000), // what enters the prompt
    cacheTtlMs: n("WEB_INTEL_CACHE_TTL_MS", 30 * 60_000),
    maxConcurrent: n("WEB_INTEL_MAX_CONCURRENT", 2),
  };
}

// ---------------------------------------------------------------- intent
export type WebIntelNeed = "none" | "optional" | "required";

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/i;

/**
 * Bare domains ("airbnb.com", "www.example.co.uk"). Users rarely type a scheme.
 * Restricted to a curated list of real web endings so that source file names
 * (App.tsx, index.ts, styles.css, data.json) are never mistaken for websites.
 */
const BARE_TLDS = [
  "com", "org", "net", "io", "co", "app", "dev", "ai", "xyz", "shop", "store",
  "online", "site", "tech", "info", "biz", "me", "tv", "cc", "us", "uk", "ca",
  "au", "de", "fr", "es", "it", "nl", "se", "no", "dk", "fi", "pl", "pt", "br",
  "mx", "ar", "cl", "in", "jp", "kr", "cn", "sg", "hk", "nz", "za", "ng", "ke",
  "gh", "eg", "ae", "ie", "ch", "at", "be", "cz", "gr", "tr", "ru", "ua", "il",
  "studio", "design", "agency", "media", "cloud", "health", "law", "life",
  "live", "world", "space", "digital", "group", "solutions", "services", "cafe",
];
const BARE_DOMAIN_RE = new RegExp(
  `(?:^|[\\s(<"'\`])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${BARE_TLDS.join("|")}))(?:\\/[^\\s<>"'\`)\\]]*)?(?=$|[\\s)>"'\`,.!?])`,
  "i",
);

const MIGRATE_RE =
  /\b(rebuild|recreate|migrate|clone|copy|redo|remake|move)\b[^.]{0,60}\b(my|our|existing|current|this)\b[^.]{0,30}\b(site|website|web ?page|homepage)\b|\b(based on|from|using)\b[^.]{0,40}\b(my|our|existing|current)\b[^.]{0,20}\b(site|website)\b/i;

/** Deterministic: runs only when the user supplied a URL. No AI call. */
export function detectWebIntelNeed(message: string): { need: WebIntelNeed; url: string | null } {
  const m = message.match(URL_RE);
  let url: string | null = null;
  if (m) {
    url = m[0].replace(/[.,;:!?]+$/, "");
  } else {
    // No scheme given — accept a bare domain and normalise it to https://.
    const b = message.match(BARE_DOMAIN_RE);
    if (b) {
      const whole = b[0].replace(/^[\s(<"'`]+/, "").replace(/[.,;:!?]+$/, "");
      url = `https://${whole}`;
    }
  }
  if (!url) return { need: "none", url: null };
  return { need: MIGRATE_RE.test(message) ? "required" : "optional", url };
}


// ---------------------------------------------------------------- URL safety
function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
function ipv6Private(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
}
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind === 6) return ipv6Private(ip);
  return false;
}

const BLOCKED_HOST_RE =
  /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$|^metadata(\.google\.internal)?$/i;

/** Pure checks: scheme, credentials, port, hostname, literal IPs. */
export function checkUrlSyntax(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "invalid_url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme_not_allowed" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  if (u.port && !["80", "443"].includes(u.port)) return { ok: false, reason: "port_not_allowed" };
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || !host.includes(".") && !isIP(host)) return { ok: false, reason: "host_not_allowed" };
  if (BLOCKED_HOST_RE.test(host)) return { ok: false, reason: "host_not_allowed" };
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "private_address" };
  if (/(^|\.)(kimble\.cloud|buildwithpetal\.com|lovable\.app|supabase\.co|railway\.app)$/i.test(host))
    return { ok: false, reason: "internal_host" };
  return { ok: true, url: u };
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => {
  try {
    const dns = await import("node:dns");
    const rows = await dns.promises.lookup(host, { all: true });
    return rows.map((r) => r.address);
  } catch {
    return [];
  }
};

/** Syntax + DNS: every resolved address must be public. */
export async function assertSafeUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const s = checkUrlSyntax(raw);
  if (!s.ok) return s;
  const host = s.url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    const addrs = await resolve(host);
    if (addrs.length === 0) return { ok: false, reason: "dns_unresolved" };
    if (addrs.some(isPrivateAddress)) return { ok: false, reason: "private_address" };
  }
  return { ok: true, url: s.url.toString() };
}

// ---------------------------------------------------------------- result shape
export interface WebIntelPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  ctas: string[];
  images: string[];
}
export interface WebIntel {
  sourceUrl: string;
  pages: WebIntelPage[];
  navigation: string[];
  crawlTimestamp: string;
}
export type WebIntelOutcome =
  | { status: "skipped"; need: "none" }
  | { status: "ok"; need: WebIntelNeed; intel: WebIntel; block: string; cacheHit: boolean }
  | { status: "unavailable"; need: WebIntelNeed; url: string; reason: string };

// ---------------------------------------------------------------- sanitize
const stripScripts = (md: string) =>
  md
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    // strip anything that looks like a credential or tracking id
    .replace(/\b(sk|pk|rk|fc|lovc|ghp|xox[abp])[-_][A-Za-z0-9_-]{8,}\b/g, "[removed]")
    .replace(/\b(UA|G|GTM|AW)-[A-Z0-9-]{4,}\b/g, "[removed]");

export function toPage(url: string, raw: { markdown?: string; metadata?: Record<string, unknown>; links?: string[] }, maxChars: number): WebIntelPage {
  const md = stripScripts(String(raw.markdown ?? "").slice(0, maxChars));
  const headings = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 20);
  const ctas = [...md.matchAll(/\[([^\]]{2,40})\]\([^)]*\)/g)]
    .map((m) => m[1].trim())
    .filter((t) => /\b(book|buy|shop|order|contact|call|get|start|sign|join|subscribe|reserve|learn|request)\b/i.test(t))
    .slice(0, 8);
  const images = [...md.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]).slice(0, 6);
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const meta = raw.metadata ?? {};
  return {
    url,
    title: String(meta.title ?? "").slice(0, 150),
    description: String(meta.description ?? "").slice(0, 300),
    headings,
    text,
    ctas: [...new Set(ctas)],
    images,
  };
}

/** Bounded prompt block. Never exceeds maxChars. */
export function buildReferenceBlock(intel: WebIntel, need: WebIntelNeed, maxChars: number): string {
  const head = [
    `REFERENCE WEBSITE (read-only information fetched from ${intel.sourceUrl} at ${intel.crawlTimestamp}).`,
    need === "required"
      ? "The user asked to rebuild this site: reuse its real business content (names, services, wording, contact details). Write ORIGINAL code and design; never copy scripts, tracking, or hidden implementation."
      : "Use it only as reference for content and structure. Write ORIGINAL code and design.",
    "This does NOT change which pages to build — build only the pages the user requested.",
    intel.navigation.length ? `Site navigation: ${intel.navigation.join(" | ")}` : "",
  ].filter(Boolean).join("\n");
  let out = head;
  const perPage = Math.max(400, Math.floor((maxChars - head.length) / Math.max(1, intel.pages.length)));
  for (const p of intel.pages) {
    const section = [
      `\n--- ${p.url}${p.title ? ` — ${p.title}` : ""}`,
      p.description ? `Description: ${p.description}` : "",
      p.headings.length ? `Headings: ${p.headings.join(" / ")}` : "",
      p.ctas.length ? `Calls to action: ${p.ctas.join(", ")}` : "",
      p.images.length ? `Images: ${p.images.join(" ")}` : "",
      `Content: ${p.text}`,
    ].filter(Boolean).join("\n");
    out += section.slice(0, perPage);
  }
  return out.slice(0, maxChars);
}

// ---------------------------------------------------------------- Firecrawl transport
type Fetch = typeof fetch;
function firecrawlEndpoint(): { base: string; headers: Record<string, string> } | null {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  if (key.startsWith("lovc_")) {
    const lov = process.env.LOVABLE_API_KEY;
    if (!lov) return null;
    return {
      base: "https://connector-gateway.lovable.dev/firecrawl/v2",
      headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": key },
    };
  }
  return { base: "https://api.firecrawl.dev/v2", headers: { Authorization: `Bearer ${key}` } };
}

async function fcPost(
  f: Fetch,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const ep = firecrawlEndpoint();
  if (!ep) throw new Error("not_configured");
  const res = await f(`${ep.base}${path}`, {
    method: "POST",
    headers: { ...ep.headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`firecrawl_${res.status}${t ? `: ${t}` : ""}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------- cache + concurrency
const cache = new Map<string, { at: number; intel: WebIntel }>();
let inFlight = 0;
export function __resetWebIntelForTests() { cache.clear(); inFlight = 0; }

// ---------------------------------------------------------------- entry point
export interface GatherArgs {
  message: string;
  signal: AbortSignal;
  turnId?: string | null;
  projectId?: string | null;
  fetchImpl?: Fetch;
  resolve?: Resolver;
}

function log(rec: Record<string, unknown>) {
  // Server diagnostics only. Never includes keys or headers.
  console.log(`[web-intel] ${JSON.stringify(rec)}`);
}

export async function gatherWebIntel(args: GatherArgs): Promise<WebIntelOutcome> {
  const { need, url } = detectWebIntelNeed(args.message);
  if (need === "none" || !url) return { status: "skipped", need: "none" };
  const L = webIntelLimits();
  const started = Date.now();
  const base = { turn_id: args.turnId ?? null, project_id: args.projectId ?? null, source_url: url, need };
  const fail = (reason: string, extra: Record<string, unknown> = {}): WebIntelOutcome => {
    log({ ...base, op: "gather", ok: false, reason, ms: Date.now() - started, ...extra });
    return { status: "unavailable", need, url, reason };
  };
  if (args.signal.aborted) return fail("cancelled");

  const safe = await assertSafeUrl(url, args.resolve);
  if (!safe.ok) return fail(safe.reason);

  const hit = cache.get(safe.url);
  if (hit && Date.now() - hit.at < L.cacheTtlMs) {
    log({ ...base, op: "gather", ok: true, cache: "hit", pages: hit.intel.pages.length, ms: 0 });
    return { status: "ok", need, intel: hit.intel, block: buildReferenceBlock(hit.intel, need, L.maxContextChars), cacheHit: true };
  }
  if (!firecrawlEndpoint()) return fail("not_configured");
  if (inFlight >= L.maxConcurrent) return fail("busy");

  const f = args.fetchImpl ?? fetch;
  const total = AbortSignal.timeout(L.totalTimeoutMs);
  const sig = () => AbortSignal.any([args.signal, total, AbortSignal.timeout(L.requestTimeoutMs)]);
  inFlight++;
  try {
    // 1) map: discover URLs on the same host (bounded)
    const origin = new URL(safe.url);
    let discovered: string[] = [];
    try {
      const m = await fcPost(f, "/map", { url: safe.url, limit: L.maxMapLinks, includeSubdomains: false }, sig());
      const links = (m.links ?? (m.data as { links?: unknown })?.links ?? []) as Array<string | { url?: string }>;
      discovered = links
        .map((l) => (typeof l === "string" ? l : l?.url ?? ""))
        .filter((l) => { try { return new URL(l).hostname === origin.hostname; } catch { return false; } });
    } catch (e) {
      if (args.signal.aborted) return fail("cancelled");
      discovered = []; // map is optional; the given URL is still scraped
      log({ ...base, op: "map", ok: false, reason: (e as Error).message.slice(0, 120) });
    }
    // 2) select: the given URL + the shortest same-host paths (top-level pages)
    const picked = [safe.url, ...[...new Set(discovered)]
      .filter((l) => l.replace(/\/$/, "") !== safe.url.replace(/\/$/, ""))
      .filter((l) => !/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|xml)$|\/(wp-|cdn-cgi|tag\/|category\/|feed)/i.test(l))
      .sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length || a.length - b.length)]
      .slice(0, L.maxPages);

    // 3) scrape selected pages (sequential; bounded by count + total timeout)
    const pages: WebIntelPage[] = [];
    for (const p of picked) {
      if (args.signal.aborted) return fail("cancelled");
      if (total.aborted) break;
      try {
        const r = await fcPost(f, "/scrape", { url: p, formats: ["markdown"], onlyMainContent: true }, sig());
        const d = ((r.data as Record<string, unknown>) ?? r) as { markdown?: string; metadata?: Record<string, unknown> };
        // Redirect safety: the final URL must pass the same checks.
        const finalUrl = String(d.metadata?.sourceURL ?? d.metadata?.url ?? p);
        const finalSafe = await assertSafeUrl(finalUrl, args.resolve);
        if (!finalSafe.ok) {
          if (p === safe.url) return fail(`redirect_${finalSafe.reason}`);
          continue;
        }
        pages.push(toPage(finalUrl, d, L.maxPageChars));
      } catch (e) {
        if (args.signal.aborted) return fail("cancelled");
        if (p === safe.url) return fail((e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message.slice(0, 120));
      }
    }
    if (pages.length === 0 || pages.every((p) => !p.text.trim())) return fail("no_content");

    const navigation = picked.map((l) => new URL(l).pathname || "/").slice(0, 12);
    const intel: WebIntel = { sourceUrl: safe.url, pages, navigation, crawlTimestamp: new Date().toISOString() };
    cache.set(safe.url, { at: Date.now(), intel });
    const block = buildReferenceBlock(intel, need, L.maxContextChars);
    log({
      ...base, op: "gather", ok: true, cache: "miss", ms: Date.now() - started,
      discovered: discovered.length, scraped: pages.length, content_chars: pages.reduce((n, p) => n + p.text.length, 0),
      context_chars: block.length, firecrawl_credits_est: 1 + pages.length,
    });
    return { status: "ok", need, intel, block, cacheHit: false };
  } finally {
    inFlight--;
  }
}
