/**
 * Petal subdomain — claim/release `<slug>.buildwithpetal.com` for a project.
 *
 * Implementation re-uses our existing **Cloudflare for SaaS** pipeline (see
 * `cloudflare-saas.server.ts`). A Petal subdomain is just a custom hostname
 * we register on the user's behalf — Cloudflare handles SSL automatically and
 * `host-routing.server.ts` already proxies any registered hostname to the
 * project's Cloudflare Pages deployment.
 *
 * Why this works without an extra DNS step:
 *   `*.buildwithpetal.com` already resolves through our zone (this is the
 *   same zone we register customer custom hostnames on). When we POST a new
 *   custom hostname like `acme.buildwithpetal.com`, Cloudflare provisions
 *   the cert *and* serves it on the apex, because the hostname lives inside
 *   our own SaaS zone. No CNAME for the user to add, no extra DNS record
 *   for us to create — the SaaS zone is already authoritative.
 *
 * Suggesting a slug:
 *   `suggestSlugFromTitle()` is a pure helper used by the UI to pre-fill a
 *   reasonable default. Rules:
 *     - lowercase, [a-z0-9-]
 *     - 3..40 chars
 *     - never starts/ends with a hyphen
 *     - never matches the reserved list enforced by the DB trigger
 *     - falls back to `petal-app-XXXXXX` if the title is unusable
 */
import {
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
  mapCfStatus,
} from "@/server/cloudflare-saas.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PETAL_ROOT_DOMAIN = "buildwithpetal.com";

/** Mirror of the DB trigger's reserved list (cheap UX validation). */
const RESERVED = new Set<string>([
  "www", "api", "admin", "app", "mail", "email", "ftp", "smtp", "pop",
  "imap", "webmail", "cpanel", "whm", "ns", "ns1", "ns2", "mx", "dns",
  "static", "assets", "cdn", "docs", "help", "support", "status",
  "blog", "shop", "store", "pay", "billing", "auth", "login", "signup",
  "register", "account", "dashboard", "console", "portal", "manage",
  "petal", "buildwithpetal", "lovable", "about", "contact", "pricing",
  "terms", "privacy", "legal", "security", "changelog", "roadmap",
  "preview", "staging", "dev", "test", "qa", "demo", "sandbox",
  "beta", "alpha", "edge", "workers", "pages", "cf", "cloudflare",
]);

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/** Pure validator — same rules as the DB trigger. Use to fail fast in the UI/API. */
export function validateSlug(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 40) {
    return { ok: false, reason: "Subdomain must be between 3 and 40 characters." };
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason:
        "Use lowercase letters, numbers, and hyphens only. Cannot start or end with a hyphen.",
    };
  }
  if (RESERVED.has(slug)) {
    return { ok: false, reason: "That subdomain is reserved. Please pick another." };
  }
  return { ok: true, slug };
}

/**
 * Suggest a slug from a project title. Always returns a value that passes
 * `validateSlug()` (falls back to a randomized petal-app-XXXXXX).
 */
export function suggestSlugFromTitle(title: string | null | undefined): string {
  const base = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/[^a-z0-9]+/g, "-") // anything else → hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-") // collapse runs of hyphens
    .slice(0, 40);

  if (base.length >= 3 && !RESERVED.has(base) && SLUG_RE.test(base)) {
    return base;
  }
  // Pad short titles with a random suffix; replace reserved/empty with random.
  const rand = Math.random().toString(36).slice(2, 8);
  if (base.length === 0) return `petal-app-${rand}`;
  if (base.length < 3) return `${base}-${rand}`.slice(0, 40);
  // Reserved or otherwise invalid → randomize.
  return `petal-app-${rand}`;
}

/** Is this slug currently free across all projects? */
export async function isSlugAvailable(
  slug: string,
  excludeProjectId?: string,
): Promise<boolean> {
  let q = supabaseAdmin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("subdomain", slug);
  if (excludeProjectId) q = q.neq("id", excludeProjectId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return (count ?? 0) === 0;
}

/**
 * Claim `<slug>.buildwithpetal.com` for a project:
 *   1. Validate the slug (cheap, local) and check uniqueness.
 *   2. Set `projects.subdomain = slug` (DB trigger re-validates).
 *   3. Register the hostname with Cloudflare via the SaaS API. Idempotent —
 *      if Cloudflare already knows the hostname (e.g. retry after a partial
 *      failure) we treat that as success and reuse the existing record.
 *   4. Mirror it into `project_domains` (status=active immediately, since
 *      Cloudflare auto-issues certs for hostnames inside our own SaaS zone).
 *
 * If the user already had a different Petal subdomain claimed for this
 * project, the *caller* should release the old one first (see `releaseSubdomain`).
 */
export async function claimSubdomain(args: {
  projectId: string;
  slug: string;
}): Promise<{
  hostname: string;
  domainRowId: string;
  status: "active" | "verifying" | "pending" | "failed";
}> {
  const v = validateSlug(args.slug);
  if (!v.ok) throw new Error(v.reason);
  const slug = v.slug;
  const hostname = `${slug}.${PETAL_ROOT_DOMAIN}`;

  // Step 1: persist the slug on the project. The unique index + trigger
  // double-check format/uniqueness for us.
  const { error: projErr } = await supabaseAdmin
    .from("projects")
    .update({ subdomain: slug })
    .eq("id", args.projectId);
  if (projErr) {
    if (projErr.code === "23505") {
      throw new Error("That subdomain is already taken — pick another.");
    }
    throw new Error(projErr.message);
  }

  // Step 2: register with Cloudflare. If the hostname already exists on our
  // zone (idempotent retry, or a stale row from a failed prior attempt),
  // surface that as a soft success so the caller can move on.
  let cf;
  try {
    cf = await createCustomHostname(hostname);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cloudflare error";
    // 1414 = "custom hostname already exists in this zone".
    if (msg.includes("1414") || msg.toLowerCase().includes("already exists")) {
      // Look it up via the existing project_domains row (best effort) so we
      // can keep going. If we can't find it, surface a useful error.
      const { data: existing } = await supabaseAdmin
        .from("project_domains")
        .select("id, provider_hostname_id, status")
        .eq("hostname", hostname)
        .maybeSingle();
      if (!existing) {
        throw new Error(
          `That subdomain is registered with Cloudflare but not tracked in Petal — contact support.`,
        );
      }
      return {
        hostname,
        domainRowId: existing.id,
        status: (existing.status as "active" | "verifying" | "pending" | "failed") ?? "verifying",
      };
    }
    throw new Error(`Couldn't register with Cloudflare: ${msg}`);
  }

  const mapped = mapCfStatus(cf);

  // Step 3: mirror into project_domains. Petal subdomains don't need TXT
  // verification (the zone is ours), so we store an empty placeholder.
  const { data: domainRow, error: domErr } = await supabaseAdmin
    .from("project_domains")
    .upsert(
      {
        project_id: args.projectId,
        hostname,
        status: mapped.status,
        ssl_status: mapped.ssl_status,
        error_message: mapped.error_message,
        verification_txt_name: "(not required for petal subdomain)",
        verification_txt_value: "(not required for petal subdomain)",
        provider_hostname_id: cf.id,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "hostname" },
    )
    .select("id, status")
    .single();
  if (domErr) {
    // Best-effort rollback of the Cloudflare hostname.
    await deleteCustomHostname(cf.id).catch(() => {});
    throw new Error(domErr.message);
  }

  return {
    hostname,
    domainRowId: domainRow.id,
    status: domainRow.status as "active" | "verifying" | "pending" | "failed",
  };
}

/**
 * Release the project's current Petal subdomain (if any). Removes the
 * hostname from Cloudflare, deletes the `project_domains` row, and clears
 * `projects.subdomain`. Best-effort: if Cloudflare delete fails we still
 * clear local state so the user isn't stuck.
 */
export async function releaseSubdomain(projectId: string): Promise<void> {
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("subdomain")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.subdomain) return;
  const hostname = `${project.subdomain}.${PETAL_ROOT_DOMAIN}`;

  const { data: domain } = await supabaseAdmin
    .from("project_domains")
    .select("id, provider_hostname_id")
    .eq("hostname", hostname)
    .maybeSingle();

  if (domain?.provider_hostname_id) {
    await deleteCustomHostname(domain.provider_hostname_id).catch(() => {});
  }
  if (domain?.id) {
    await supabaseAdmin.from("project_domains").delete().eq("id", domain.id);
  }
  await supabaseAdmin
    .from("projects")
    .update({ subdomain: null })
    .eq("id", projectId);
}

/** Sync the live Cloudflare status of a Petal subdomain into project_domains. */
export async function refreshSubdomainStatus(domainRowId: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("project_domains")
    .select("provider_hostname_id")
    .eq("id", domainRowId)
    .maybeSingle();
  if (!row?.provider_hostname_id) return;
  try {
    const cf = await getCustomHostname(row.provider_hostname_id);
    const mapped = mapCfStatus(cf);
    await supabaseAdmin
      .from("project_domains")
      .update({
        status: mapped.status,
        ssl_status: mapped.ssl_status,
        error_message: mapped.error_message,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", domainRowId);
  } catch {
    // Soft-fail: status will be re-checked on next user action.
  }
}
