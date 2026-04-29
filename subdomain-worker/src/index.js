/**
 * Petal subdomain edge worker.
 *
 * Bound to the SaaS zone. For every request:
 *   1. Look up the requested host → project routing target via
 *      `https://petalapp.lovable.app/api/public/host-lookup`.
 *   2. If the project is published & public → proxy to its `pages.dev` URL.
 *   3. If unpublished / private → render a friendly placeholder.
 *   4. If the slug is unknown → 404 placeholder.
 *
 * Caches lookups for 60s in `caches.default` so static asset bursts don't
 * hammer the control plane.
 *
 * Why a Worker (instead of Cloudflare for SaaS)?
 *   CF for SaaS only intercepts traffic for *external* customer-owned
 *   hostnames CNAMEd in from another zone. It does NOT take precedence
 *   over zone-local DNS records on our own zone, so we can't use it to
 *   route `*.buildwithpetal.com`. Worker = zero per-claim DNS work, free
 *   tier covers it.
 *
 * Plain JS (not TS) because Cloudflare's plain script API doesn't transpile.
 */

const PETAL_ROOT = "buildwithpetal.com";
const CONTROL_PLANE = "https://petalapp.lovable.app";
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

async function lookup(host) {
  const cacheKey = new Request(
    `https://lookup.internal/?host=${encodeURIComponent(host)}`,
  );
  const cached = await caches.default.match(cacheKey);
  if (cached) return await cached.json();

  const res = await fetch(
    `${CONTROL_PLANE}/api/public/host-lookup?host=${encodeURIComponent(host)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return { kind: "unknown" };
  const result = await res.clone().json();
  // Cache the response (the upstream sets Cache-Control: max-age=60).
  await caches.default.put(cacheKey, res);
  return result;
}

function placeholder(kind) {
  const isPrivate = kind === "private";
  const isUnknown = kind === "unknown";
  const title = isUnknown
    ? "This Petal app doesn't exist"
    : isPrivate
      ? "This site is private"
      : "This site isn't published yet";
  const body = isUnknown
    ? "No app is connected to this subdomain. If you're the owner, claim it from your project's Publish dialog."
    : isPrivate
      ? "The owner of this app has restricted access."
      : "The owner is still working on this app. Check back soon.";
  const status = isUnknown ? 404 : isPrivate ? 403 : 404;
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
    <span class="badge">${isUnknown ? "Not found" : isPrivate ? "Private" : "Coming soon"}</span>
    <h1>${title}</h1>
    <p>${body}</p>
    <div class="footer">Built with Petal</div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function proxy(request, target, projectId) {
  const incoming = new URL(request.url);
  const upstreamUrl = new URL(incoming.pathname + incoming.search, target);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const upstream = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "cross-origin-opener-policy") return;
    if (k === "cross-origin-embedder-policy") return;
    if (k === "cross-origin-resource-policy") return;
    respHeaders.set(key, value);
  });

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });

  // Inject the page-view tracker into HTML responses only.
  const ct = (respHeaders.get("content-type") || "").toLowerCase();
  if (projectId && ct.includes("text/html") && upstream.status >= 200 && upstream.status < 300) {
    return new HTMLRewriter()
      .on("head", new TrackerInjector(projectId))
      .transform(response);
  }
  return response;
}

/**
 * HTMLRewriter handler that appends a small tracking beacon at the end of
 * <head>. The beacon computes a daily-rotating, IP-less visitor hash in the
 * browser and POSTs it to the control plane. `keepalive` lets the request
 * survive page unload.
 */
class TrackerInjector {
  constructor(projectId) {
    this.projectId = projectId;
  }
  element(el) {
    const pid = JSON.stringify(this.projectId);
    const endpoint = JSON.stringify(`${CONTROL_PLANE}/api/public/track`);
    const script = `<script>(function(){try{
var p=${pid};var e=${endpoint};
var d=new Date().toISOString().slice(0,10);
var s=(navigator.userAgent||"")+"|"+(navigator.language||"")+"|"+screen.width+"x"+screen.height+"|"+d+"|"+p;
var h=0;for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}
var v="v"+(h>>>0).toString(36);
var b=JSON.stringify({project_id:p,path:location.pathname,referrer:document.referrer||"",visitor_hash:v});
if(navigator.sendBeacon){navigator.sendBeacon(e,new Blob([b],{type:"application/json"}));}
else{fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:b,keepalive:true}).catch(function(){});}
}catch(_){}})();</script>`;
    el.append(script, { html: true });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.host.toLowerCase();

    if (
      host === `www.${PETAL_ROOT}` ||
      host === `fallback.${PETAL_ROOT}` ||
      host === PETAL_ROOT
    ) {
      return new Response("Not found", { status: 404 });
    }

    const result = await lookup(host);
    if (result.kind === "proxy") return proxy(request, result.target, result.projectId);
    return placeholder(result.kind);
  },
};
