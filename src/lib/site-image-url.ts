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
