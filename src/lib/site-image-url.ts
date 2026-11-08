/** Hosts a project's subdomain can be served under. */
export const SITE_ROOTS = ["sites.custardai.dev", "buildwithpetal.com"];

/**
 * True when `url` is https and its host is the project's own address: its
 * subdomain under a Petal site root, or one of its active connected domains.
 */
export function isOwnSiteImageUrl(url: string, subdomain: string | null, domains: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const allowed = new Set(domains.map((d) => d.toLowerCase()));
  if (subdomain) for (const r of SITE_ROOTS) allowed.add(`${subdomain.toLowerCase()}.${r}`);
  return allowed.has(host);
}

/** Partner domains whose hosted logos Petal copies into its own storage. */
export const PARTNER_ASSET_ROOTS = ["custardai.dev"];

/** True when `url` is https on a partner domain (the root or any subdomain). */
export function isPartnerAssetUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return PARTNER_ASSET_ROOTS.some((r) => host === r || host.endsWith(`.${r}`));
}

/** Image types accepted as a tab icon, with the file extension they are saved under. */
const ICON_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Largest tab icon Petal copies (1 MB). */
export const MAX_ICON_BYTES = 1024 * 1024;

/** File extension for an accepted icon content type, else null. */
export function iconExtension(contentType: string | null): string | null {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return ICON_TYPES[t] ?? null;
}
