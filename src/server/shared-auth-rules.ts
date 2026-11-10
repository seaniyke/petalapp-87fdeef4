/**
 * Pure rules for site-visitor password reset and Google sign-in (unit-tested).
 *
 * Both flows send a secret back to a web address: a reset link in an email,
 * or a sign-in token after Google. That address must belong to the site that
 * asked, or a stranger could have the secret delivered to their own page.
 */

/** Roots whose `<subdomain>.<root>` addresses are Petal-hosted sites. */
export const SITE_ROOTS = ["buildwithpetal.com", "sites.custardai.dev", "kimble.cloud"];

export const RESET_RULES = {
  /** A reset link works for one hour, once. */
  ttlMs: 60 * 60 * 1000,
  /** Reset emails per visitor account per hour. */
  perUserPerHour: 3,
  /** Reset emails per site per hour (bounds email cost and abuse). */
  perProjectPerHour: 50,
} as const;

export type SiteHosts = {
  /** Petal subdomain slug, if the site has one. */
  subdomain: string | null;
  /** The site's Cloudflare Pages project name (`petal-<12 hex>`). */
  pagesProject: string;
  /** Active custom hostnames. */
  domains: string[];
};

/** Mirrors builder/src/build.ts → projectNameFor(). */
export function pagesProjectName(projectId: string): string {
  return `petal-${projectId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

/** True when `raw` is an https address on one of this site's own hosts. */
export function isSiteAddress(raw: string, hosts: SiteHosts): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  if (hosts.subdomain && SITE_ROOTS.some((r) => h === `${hosts.subdomain!.toLowerCase()}.${r}`)) return true;
  const pages = `${hosts.pagesProject}.pages.dev`;
  if (h === pages || h.endsWith(`.${pages}`)) return true;
  return hosts.domains.some((d) => d.toLowerCase() === h);
}

/** The reset/sign-in address with the secret in the #fragment (never sent to servers or logs). */
export function withFragment(raw: string, key: string, value: string): string {
  const u = new URL(raw);
  u.hash = `${key}=${encodeURIComponent(value)}`;
  return u.toString();
}

/** Site-visitor Google sign-in is offered only when Petal's Google app is configured. */
export function googleConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.PETAL_GOOGLE_CLIENT_ID && env.PETAL_GOOGLE_CLIENT_SECRET);
}
