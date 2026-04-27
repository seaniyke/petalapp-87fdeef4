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

/**
 * Result of resolving a custom hostname to a target.
 *
 *   - `proxy`: forward the request to `pagesUrl`.
 *   - `unpublished`: the project exists and the domain is active, but the
 *     owner hasn't published it yet (`published_visibility = 'unpublished'`).
 *     We render a friendly placeholder instead of proxying to a stale build.
 *   - `private`: visibility is `private` — only workspace members can view.
 *     Returned as a 403 placeholder for now (no auth gate yet on the proxy).
 *   - `null`: hostname isn't owned by any project; fall through to the Petal
 *     app (404 / marketing).
 */
type DomainTarget =
  | { kind: "proxy"; projectId: string; pagesUrl: string }
  | { kind: "unpublished"; projectId: string }
  | { kind: "private"; projectId: string }
  | null;

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

  // Look up the project's published state. We only care about visibility +
  // the pinned build's dist_path (when present) — the latter lets future
  // per-build deployments serve the pinned version even after a newer
  // preview build lands. Today every build overwrites the same Pages URL,
  // so the dist_path lookup is a no-op fallback.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, published_visibility, published_build_id")
    .eq("id", data.project_id)
    .maybeSingle();

  const visibility = project?.published_visibility ?? "unpublished";
  if (visibility === "unpublished") {
    return { kind: "unpublished", projectId: data.project_id };
  }
  if (visibility === "private") {
    return { kind: "private", projectId: data.project_id };
  }

  // Visibility = public. Prefer the pinned published build's dist_path when
  // we have one (forward-compatible with per-build deployments); otherwise
  // fall back to the project's canonical Pages URL.
  let pagesUrl = `https://${pagesProjectName(data.project_id)}.pages.dev`;
  if (project?.published_build_id) {
    const { data: build } = await supabaseAdmin
      .from("project_builds")
      .select("dist_path, status")
      .eq("id", project.published_build_id)
      .maybeSingle();
    if (build?.status === "ready" && build.dist_path) {
      pagesUrl = build.dist_path.replace(/\/$/, "");
    }
  }
  return { kind: "proxy", projectId: data.project_id, pagesUrl };
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

/**
 * Render a friendly placeholder when a custom domain is connected but the
 * project isn't published (or is published privately). Visitors get a clean
 * branded page instead of a confusing proxy error.
 */
export function renderUnpublishedPage(
  kind: "unpublished" | "private",
): Response {
  const isPrivate = kind === "private";
  const title = isPrivate ? "This site is private" : "This site isn't published yet";
  const body = isPrivate
    ? "The owner of this app has restricted access. Sign in with the owner's workspace to view it."
    : "The owner is still working on this app. Check back soon, or get in touch with them for an update.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; padding: 2rem; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #f5f5f5; } }
  main { max-width: 32rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; letter-spacing: -0.01em; }
  p { margin: 0; line-height: 1.55; opacity: 0.75; }
  .badge { display: inline-block; padding: 0.25rem 0.625rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; background: rgba(0,0,0,0.06); margin-bottom: 1rem; }
  @media (prefers-color-scheme: dark) { .badge { background: rgba(255,255,255,0.08); } }
  .footer { margin-top: 2rem; font-size: 0.75rem; opacity: 0.5; }
</style>
</head>
<body>
  <main>
    <span class="badge">${isPrivate ? "Private" : "Coming soon"}</span>
    <h1>${title}</h1>
    <p>${body}</p>
    <div class="footer">Built with Petal</div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: isPrivate ? 403 : 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
