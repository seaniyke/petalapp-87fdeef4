/**
 * Custom-domain runtime routing — host → project lookup + reverse proxy.
 *
 * When a request arrives at a custom hostname (e.g. acme.com), we:
 *   1. Skip Petal's own hosts (marketing site, *.lovable.app, localhost, etc.)
 *   2. Look up the project that owns that hostname in `project_domains`
 *   3. Proxy the request to that project's deployed Cloudflare Pages URL
 *      (https://petal-<projectId-prefix>.pages.dev) and stream the response
 *
 * The lookup is cached in-memory for 60s to avoid hammering Postgres on every
 * asset request. Cache is per-Worker-instance — invalidates naturally on
 * deploy/restart and stays fresh enough for typical domain edits.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Hosts that belong to Petal itself — never proxy these. Exact match or
 * suffix match (for wildcards like `.lovable.app`).
 *
 * Hardcoded for v1; move to env var (PETAL_RESERVED_HOSTS) if/when we add
 * more marketing domains.
 */
const RESERVED_EXACT = new Set([
  "buildwithpetal.com",
  "www.buildwithpetal.com",
  "petalapp.lovable.app",
  "localhost",
]);
const RESERVED_SUFFIXES = [
  ".lovable.app", // covers id-preview--*.lovable.app, *-dev.lovable.app, etc.
  ".pages.dev", // our own build outputs — don't recursively proxy
];

export function isReservedHost(host: string): boolean {
  // Strip port if present.
  const h = host.toLowerCase().split(":")[0];
  if (RESERVED_EXACT.has(h)) return true;
  return RESERVED_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/** Mirrors builder/src/build.ts → projectNameFor(). */
function pagesProjectName(projectId: string): string {
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

type DomainTarget = {
  projectId: string;
  pagesUrl: string; // e.g. https://petal-abc123def456.pages.dev
} | null;

const CACHE_TTL_MS = 60_000;
type CacheEntry = { value: DomainTarget; expiresAt: number };
const cache = new Map<string, CacheEntry>();

async function lookupDomain(hostname: string): Promise<DomainTarget> {
  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .select("project_id, status")
    .eq("hostname", hostname)
    .maybeSingle();
  if (error || !data) return null;
  // Only proxy active domains — pending/failed ones get the default Petal site
  // (which is fine; the user is still mid-setup).
  if (data.status !== "active") return null;
  return {
    projectId: data.project_id,
    pagesUrl: `https://${pagesProjectName(data.project_id)}.pages.dev`,
  };
}

export async function resolveHost(hostname: string): Promise<DomainTarget> {
  const key = hostname.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await lookupDomain(key);
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * Headers we strip when forwarding to Pages — these are hop-by-hop or would
 * confuse the upstream (e.g. forwarding our `host` would make Pages reject
 * the request, since it expects its own *.pages.dev hostname).
 */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

export async function proxyToPages(
  request: Request,
  pagesUrl: string,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, pagesUrl);

  // Build forward headers — drop hop-by-hop, let upstream set its own host.
  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) forwardHeaders.set(key, value);
  });
  // Forward the original host so the project app can read it if needed.
  forwardHeaders.set("x-forwarded-host", incoming.host);
  forwardHeaders.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: forwardHeaders,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });

  // Strip hop-by-hop response headers and any COEP/COOP we'd otherwise inject
  // (we don't want to force cross-origin isolation on customer apps).
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "cross-origin-opener-policy") return;
    if (k === "cross-origin-embedder-policy") return;
    if (k === "cross-origin-resource-policy") return;
    respHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
