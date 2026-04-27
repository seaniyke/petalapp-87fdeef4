/**
 * Resolve the URL where a project's published app is reachable.
 *
 * Priority:
 *   1. The project's primary custom domain (`projects.primary_domain_id` →
 *      `project_domains.hostname`, only if the domain is `active`).
 *   2. The latest successful build's `dist_path` (e.g. the Cloudflare Pages
 *      deployment URL the build callback wrote).
 *   3. `null` — the project has never had a successful build, so there is
 *      nothing live yet.
 *
 * Used by the Publish sheet to show "your website URL" and by the header
 * status pill to know whether to render an "Open" link.
 */
import { supabase } from "@/integrations/supabase/client";

export type PublishedUrlResult = {
  url: string | null;
  /** Where the URL came from — drives the label ("Custom domain" vs "Petal subdomain"). */
  source: "custom_domain" | "deployment" | "none";
  /** The hostname to display (without protocol/path). Useful for the input field. */
  display: string | null;
};

export async function resolvePublishedUrl(
  projectId: string,
  primaryDomainId: string | null,
  latestBuildId: string | null,
): Promise<PublishedUrlResult> {
  // 1) Primary custom domain — only counts if it's active.
  if (primaryDomainId) {
    const { data: domain } = await supabase
      .from("project_domains")
      .select("hostname, status")
      .eq("id", primaryDomainId)
      .maybeSingle();
    if (domain && domain.status === "active") {
      const url = `https://${domain.hostname}`;
      return { url, source: "custom_domain", display: domain.hostname };
    }
  }

  // 2) Latest successful build's deployment URL.
  if (latestBuildId) {
    const { data: build } = await supabase
      .from("project_builds")
      .select("status, dist_path")
      .eq("id", latestBuildId)
      .maybeSingle();
    if (build?.status === "ready" && build.dist_path) {
      // Strip protocol for display.
      const display = build.dist_path.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return { url: build.dist_path, source: "deployment", display };
    }
  }

  return { url: null, source: "none", display: null };
}
