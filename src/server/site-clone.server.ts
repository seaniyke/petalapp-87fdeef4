/**
 * Clone-from-URL — design-system extraction.
 *
 * `web-grounding.server.ts` already fetches a page's *text* so the model can
 * write real copy. That is only half of a clone: the reason Kimble's "make me
 * a site like X" output looked nothing like X is that we threw away every
 * visual signal on the page — its palette, its type pair, its section order.
 *
 * This module reads the same HTML (plus its linked stylesheets, bounded) and
 * extracts a design brief:
 *
 *   - brand name + tagline
 *   - palette (CSS custom properties first, then hex/rgb frequency)
 *   - font families (Google Fonts links, @font-face, font-family decls)
 *   - border radius + whether the page reads light or dark
 *   - section outline (nav labels, h1/h2 order, primary CTA labels)
 *
 * Deliberate non-goals, stated honestly in the prompt block so the model does
 * not pretend otherwise:
 *   - No site discovery/cataloguing. The user hands us a URL.
 *   - No auth-walled, paywalled or heavily client-rendered content.
 *   - No copying of logos, imagery or other copyrighted assets — Kimble
 *     regenerates an original brand mark and original copy.
 *   - Not pixel-perfect. This is an interpretation, not a copy.
 *
 * Zero new dependencies, bounded fetches, and failure-tolerant: any error
 * yields `null` and the turn proceeds with plain text grounding.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 400_000;
const MAX_CSS_BYTES = 250_000;
const MAX_STYLESHEETS = 3;

export type CloneBrief = {
  url: string;
  brand: string;
  tagline: string;
  colors: string[];
  fonts: string[];
  radius: string | null;
  scheme: "light" | "dark";
  nav: string[];
  headings: string[];
  ctas: string[];
};

/** Common UI greys/whites are not brand colours; they add nothing to a brief. */
function isBoring(hex: string): boolean {
  const h = hex.toLowerCase();
  if (/^#(fff|000)$/.test(h) || /^#(ffffff|000000)$/.test(h)) return true;
  const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
  if (!/^#[0-9a-f]{6}$/.test(full)) return true;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Near-greyscale: saturation below ~8% carries no brand information.
  return max - min < 20;
}

function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function collect(re: RegExp, source: string, group = 1): string[] {
  return Array.from(source.matchAll(re), (m) => m[group]).filter(Boolean);
}

function uniqueTrimmed(values: string[], max: number, maxLen = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
    if (v.length < 2) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchText(url: string, maxBytes: number): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PetalBuilder/1.0; +https://buildwithpetal.com)",
        Accept: "text/html,text/css,*/*",
        // Without this, geo-routed sites answer in the datacentre's language
        // and the brief hands the model copy in the wrong tongue.
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!resp.ok) return null;
    return (await resp.text()).slice(0, maxBytes);
  } catch {
    return null;
  }
}

function extractPalette(html: string, css: string): string[] {
  const source = `${html}\n${css}`;
  // 1. Declared design tokens win — a site that ships `--brand: #ff5a1f` has
  //    told us exactly what its primary is.
  const tokenHexes = collect(
    /--[a-z0-9-]*(?:brand|primary|accent|secondary|highlight)[a-z0-9-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    source,
  ).map(normalizeHex);

  // 2. Otherwise fall back to the most frequent saturated hex on the page.
  const counts = new Map<string, number>();
  for (const raw of collect(/(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g, source)) {
    const hex = normalizeHex(raw);
    if (isBoring(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const frequent = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  return uniqueTrimmed([...tokenHexes.filter((h) => !isBoring(h)), ...frequent], 6, 9);
}

function extractFonts(html: string, css: string): string[] {
  const google = collect(
    /fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi,
    html,
  ).flatMap((qs) =>
    collect(/family=([^&:"']+)/gi, qs).map((f) => decodeURIComponent(f).replace(/\+/g, " ")),
  );
  const faces = collect(/@font-face[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi, css);
  const decls = collect(/font-family\s*:\s*([^;}"']+)/gi, `${html}\n${css}`).map(
    (v) => v.split(",")[0].replace(/["']/g, ""),
  );
  const generic = /^(inherit|initial|unset|var\(|serif|sans-serif|monospace|system-ui|-apple-system|ui-|cursive|fantasy)/i;
  return uniqueTrimmed([...google, ...faces, ...decls].filter((f) => !generic.test(f.trim())), 4, 40);
}

function detectScheme(html: string, css: string): "light" | "dark" {
  if (/color-scheme\s*:\s*dark/i.test(css) || /<html[^>]+class="[^"]*\bdark\b/i.test(html)) {
    return "dark";
  }
  const bg = `${html}\n${css}`.match(
    /(?:background(?:-color)?|--background)\s*:\s*(#[0-9a-fA-F]{6})/i,
  );
  if (bg) {
    const hex = normalizeHex(bg[1]);
    const lum =
      0.299 * parseInt(hex.slice(1, 3), 16) +
      0.587 * parseInt(hex.slice(3, 5), 16) +
      0.114 * parseInt(hex.slice(5, 7), 16);
    return lum < 110 ? "dark" : "light";
  }
  return "light";
}

/**
 * Build a design brief for one URL. Returns `null` when the page can't be
 * read (network error, non-HTML, auth wall, or a shell with no real markup).
 */
export async function extractCloneBrief(url: string): Promise<CloneBrief | null> {
  const html = await fetchText(url, MAX_HTML_BYTES);
  if (!html || !/<html|<body|<head/i.test(html)) return null;

  // Linked stylesheets carry the palette and type scale that inline markup
  // usually hides behind utility class names.
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return null;
  }
  const hrefs = collect(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["']/gi,
    html,
  ).slice(0, MAX_STYLESHEETS);
  const sheets = await Promise.all(
    hrefs.map(async (href) => {
      try {
        return await fetchText(new URL(href, base).toString(), MAX_CSS_BYTES);
      } catch {
        return null;
      }
    }),
  );
  const inline = collect(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, html).join("\n");
  const css = [inline, ...sheets.filter(Boolean)].join("\n").slice(0, MAX_CSS_BYTES);

  const title = textOf(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const ogSite = html.match(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    "";

  const brand = decodeEntities(ogSite ?? title.split(/[|—–-]/)[0] ?? base.hostname).trim();
  const headings = uniqueTrimmed(
    collect(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi, html, 2).map(textOf),
    10,
    90,
  );
  const navHtml = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? "";
  const nav = uniqueTrimmed(collect(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, navHtml).map(textOf), 8, 28);
  const ctas = uniqueTrimmed(
    [
      ...collect(/<button\b[^>]*>([\s\S]*?)<\/button>/gi, html).map(textOf),
      ...collect(/<a\b[^>]*class=["'][^"']*btn[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, html).map(textOf),
    ],
    6,
    32,
  );

  const brief: CloneBrief = {
    url,
    brand: brand.slice(0, 60) || base.hostname,
    tagline: decodeEntities(description).slice(0, 180),
    colors: extractPalette(html, css),
    fonts: extractFonts(html, css),
    radius:
      `${html}\n${css}`.match(/border-radius\s*:\s*([0-9.]+(?:px|rem))/i)?.[1] ?? null,
    scheme: detectScheme(html, css),
    nav,
    headings,
    ctas,
  };

  // A brief with no palette, no fonts and no headings is a JS shell or an
  // auth wall — better to say so than to feed the model noise.
  if (brief.colors.length === 0 && brief.fonts.length === 0 && brief.headings.length === 0) {
    return null;
  }
  return brief;
}

/** Render clone briefs as a prompt block for the builder model. */
export function renderCloneBriefBlock(briefs: CloneBrief[]): string {
  if (briefs.length === 0) return "";
  const sections = briefs
    .map((b) => {
      const lines = [
        `Source: ${b.url}`,
        `Brand: ${b.brand}`,
        b.tagline ? `Tagline / description: ${b.tagline}` : "",
        b.colors.length ? `Palette (most brand-significant first): ${b.colors.join(", ")}` : "",
        b.fonts.length ? `Type families in use: ${b.fonts.join(", ")}` : "",
        b.radius ? `Corner radius: ${b.radius}` : "",
        `Colour scheme: ${b.scheme}`,
        b.nav.length ? `Primary navigation: ${b.nav.join(" · ")}` : "",
        b.headings.length ? `Section headings in page order:\n  - ${b.headings.join("\n  - ")}` : "",
        b.ctas.length ? `Call-to-action labels: ${b.ctas.join(" · ")}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  return (
    `\n\n## Clone brief — design system read from the real page\n` +
    `Rebuild the experience with THIS design system, not a generic one. Adopt the palette as the project's semantic tokens (map the strongest colour to --primary), load the named type families for real, honour the corner radius and light/dark scheme, and follow the section order above so the page reads like the source.\n\n` +
    `Honest limits — state them to the user only if they matter for this build:\n` +
    `- This is an interpretation, not a pixel-perfect copy. You are regenerating the site, not mirroring its markup.\n` +
    `- Anything behind a login, paywall, or heavy client-side rendering was not readable; invent sensible equivalents rather than leaving gaps.\n` +
    `- Never reproduce the source's logo, wordmark, photography, or other copyrighted assets. Design an ORIGINAL brand mark and write ORIGINAL copy in the same voice.\n\n${sections}\n`
  );
}
