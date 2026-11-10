/**
 * Embeddable previews — pure rules.
 *
 * Each project has one stable preview address
 * `preview--<project id without hyphens>.sites.custardai.dev` (its certificate
 * is requested once, on the first embed). The edge worker serves the latest
 * ready build there. A one-hour embed token in `?petal_embed=<id>` on the page
 * load makes host-lookup answer with a frame-ancestors policy naming ONLY the
 * caller's allowed origin; asset requests carry no token and need none
 * (frame-ancestors only applies to documents). Without a valid token the
 * address behaves like the build's own pages.dev URL (same default policy).
 */

export const PREVIEW_SLUG_PREFIX = "preview--";
export const EMBED_ROOT = "sites.custardai.dev";
export const EMBED_PARAM = "petal_embed";
export const EMBED_TTL_MS = 60 * 60 * 1000;
const TOKEN_LEN = 24;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newEmbedToken(): string {
  let out = "";
  while (out.length < TOKEN_LEN) {
    const bytes = new Uint8Array(TOKEN_LEN * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length === TOKEN_LEN) break;
      if (b < 252) out += ALPHABET[b % 36]; // 252 = 7×36 → no modulo bias
    }
  }
  return out;
}

export function isEmbedToken(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && new RegExp(`^[a-z0-9]{${TOKEN_LEN}}$`).test(raw);
}

export function previewHost(projectId: string): string {
  return `${PREVIEW_SLUG_PREFIX}${projectId.replace(/-/g, "").toLowerCase()}.${EMBED_ROOT}`;
}

/** The project id when `slug` (the label before the root) is a preview address. */
export function projectIdFromPreviewSlug(slug: string): string | null {
  if (!slug.startsWith(PREVIEW_SLUG_PREFIX)) return null;
  const hex = slug.slice(PREVIEW_SLUG_PREFIX.length);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function embedUrl(projectId: string, token: string): string {
  return `https://${previewHost(projectId)}/?${EMBED_PARAM}=${token}`;
}

/**
 * The origin that may frame the preview: an https origin, or http on
 * localhost/127.0.0.1 for local development. Returns the normalized origin
 * (scheme://host[:port]) or null. Paths, wildcards and other schemes are refused.
 */
export function normalizeEmbedOrigin(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 300 || raw.includes("*")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  if (u.search || u.hash) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && local) return u.origin;
  return null;
}

export function frameAncestorsCsp(origin: string): string {
  return `frame-ancestors 'self' ${origin};`;
}
