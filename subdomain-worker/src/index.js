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

/**
 * Kimble's own hosts — never a customer app. Covers both the original SaaS
 * root and the current brand root, plus each one's `fallback.` origin host
 * (Cloudflare for SaaS sends customer traffic through it, but a direct visit
 * to the fallback host itself is not an app).
 */
const PETAL_ROOTS = ["sites.custardai.dev", "buildwithpetal.com", "kimble.cloud"];
const FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' https://custardai.dev https://*.custardai.dev https://*.lovable.app https://usefuljohn.com https://www.usefuljohn.com https://buildwithpetal.com https://*.buildwithpetal.com http://localhost:* http://127.0.0.1:*;";
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
    ? "This site doesn't exist"
    : isPrivate
      ? "This site is private"
      : "This site isn't published yet";
  const body = isUnknown
    ? "No app is connected to this subdomain. If you're the owner, claim it from your project's Publish dialog."
    : isPrivate
      ? "The owner of this site has restricted access."
      : "The owner is still working on this site. Check back soon.";
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

async function proxy(request, target, projectId, meta, buildId) {
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
    if (k === "content-security-policy" || k === "x-frame-options") return;
    respHeaders.set(key, value);
  });
  // Let Custard AI's in-app canvas embed every site in an iframe.
  respHeaders.set("Content-Security-Policy", FRAME_ANCESTORS_CSP);

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });

  // Inject the page-view tracker AND site meta (favicon/title/description/og)
  // into HTML responses only. Sites never show the builder's brand: with no
  // saved icon they get a letter icon made from the site name.
  const ct = (respHeaders.get("content-type") || "").toLowerCase();
  if (projectId && ct.includes("text/html") && upstream.status >= 200 && upstream.status < 300) {
    const rewriter = new HTMLRewriter()
      .on("head", new TrackerInjector(projectId))
      .on("head", new SiteMetaInjector(meta || {}, new URL(request.url).host, buildId));
    // We also drop any pre-existing <title>/<link rel="icon">/og tags so our
    // overrides actually win — generated apps usually ship with their own
    // generic ones.
    const stripper = new MetaStripper();
    rewriter.on("title", stripper);
    rewriter.on("link[rel*='icon' i]", stripper);
    rewriter.on("meta[name='description' i]", stripper);
    rewriter.on("meta[property^='og:' i]", stripper);
    rewriter.on("meta[name^='twitter:' i]", stripper);
    return rewriter.transform(response);
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
if(!navigator.sendBeacon||!navigator.sendBeacon(e,new Blob([b],{type:"application/json"}))){fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:b,keepalive:true}).catch(function(){});}
}catch(_){}})();</script>`;
    el.append(script, { html: true });
  }
}

/** Removes matched elements (used to strip the generated app's default
 *  <title>, favicon and OG tags so our injected ones win). */
class MetaStripper {
  element(el) {
    el.remove();
  }
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rounded-square letter icon from the site name, as a data: URL. Null when
 *  the name has no letter or digit (the site then has no icon). */
function letterIcon(title) {
  const m = String(title || "").trim().match(/[\p{L}\p{N}]/u);
  if (!m) return null;
  const ch = escapeHtml(m[0].toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#18181b"/><text x="32" y="44" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="34" font-weight="600" fill="#fafafa" text-anchor="middle">${ch}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The share image URL for a page: the saved one, else this site's own
 *  screenshot card. The site's own card carries the live build id so social
 *  apps fetch a fresh picture after every published build. */
function shareImageUrl(saved, host, buildId) {
  const own = host ? `https://${host}/og-image.png` : null;
  const v = buildId ? `?v=${String(buildId).slice(0, 8)}` : "";
  if (!saved) return own ? own + v : null;
  if (own && saved.split("?")[0] === own) return own + v;
  return saved;
}

/** Injects favicon + title + description + Open Graph / Twitter card tags
 *  at the start of <head>. */
class SiteMetaInjector {
  constructor(meta, host, buildId) {
    this.meta = meta;
    this.host = host;
    this.buildId = buildId;
  }
  element(el) {
    const m = this.meta || {};
    const parts = [];
    if (m.iconUrl) {
      parts.push(`<link rel="icon" href="${escapeAttr(m.iconUrl)}" />`);
      parts.push(`<link rel="apple-touch-icon" href="${escapeAttr(m.iconUrl)}" />`);
    } else {
      const letter = letterIcon(m.title);
      if (letter) parts.push(`<link rel="icon" type="image/svg+xml" href="${escapeAttr(letter)}" />`);
    }
    if (m.title) {
      parts.push(`<title>${escapeHtml(m.title)}</title>`);
      parts.push(`<meta property="og:title" content="${escapeAttr(m.title)}" />`);
      parts.push(`<meta name="twitter:title" content="${escapeAttr(m.title)}" />`);
    }
    if (m.description) {
      parts.push(`<meta name="description" content="${escapeAttr(m.description)}" />`);
      parts.push(`<meta property="og:description" content="${escapeAttr(m.description)}" />`);
      parts.push(`<meta name="twitter:description" content="${escapeAttr(m.description)}" />`);
    }
    // Share image: the saved one, else this site's own screenshot card —
    // never the builder's logo.
    const ogImage = shareImageUrl(m.ogImageUrl, this.host, this.buildId);
    if (ogImage) {
      parts.push(`<meta property="og:image" content="${escapeAttr(ogImage)}" />`);
      parts.push(`<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`);
    }
    parts.push(`<meta name="twitter:card" content="summary_large_image" />`);
    el.prepend(parts.join(""), { html: true });
  }
}

/** 1200×630 screenshot card for this site's live build, cached for one hour
 *  per build so a new publish never serves the old picture. */
async function ogImage(projectId, buildId) {
  const cacheKey = new Request(`https://og.internal/${projectId}/${buildId || "none"}.png`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${CONTROL_PLANE}/api/public/og-image/${projectId}`);
  if (!res.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const out = new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
  await caches.default.put(cacheKey, out.clone());
  return out;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.host.toLowerCase();

    // Bare partner root (no site name in front): send visitors to the
    // partner's own home page.
    if (host === "sites.custardai.dev" || host === "www.sites.custardai.dev") {
      return Response.redirect("https://custardai.dev/", 302);
    }

    const reserved = PETAL_ROOTS.some(
      (root) =>
        host === root || host === `www.${root}` || host === `fallback.${root}`,
    );
    if (reserved) {
      return new Response("Not found", { status: 404 });
    }

    const result = await lookup(host);
    if (result.kind === "proxy" && url.pathname === "/og-image.png" && request.method === "GET") {
      return ogImage(result.projectId, result.buildId);
    }
    if (result.kind === "proxy") return proxy(request, result.target, result.projectId, result.meta, result.buildId);
    return placeholder(result.kind);
  },
};
