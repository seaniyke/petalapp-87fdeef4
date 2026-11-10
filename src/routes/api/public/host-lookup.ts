/**
 * Public hostname → routing target lookup.
 *
 * Called by the edge Worker bound to the SaaS zone to figure out what to do
 * with an incoming request. Handles both Kimble subdomains and customer-owned
 * custom hostnames. Returns:
 *   - `{ kind: "proxy", target: "https://...pages.dev" }` — proxy to that URL
 *   - `{ kind: "unpublished" | "private" }` — render placeholder
 *   - `{ kind: "unknown" }` — no project owns this subdomain
 *
 * Public/no-auth on purpose: the Worker can't carry user creds. The data
 * exposed here is intentionally non-sensitive (just a hostname → pages.dev
 * mapping for *publicly published* projects).
 *
 * Lightweight cache header lets the Worker layer use `caches.default` to
 * avoid hammering us on every asset request.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EMBED_PARAM, EMBED_ROOT, frameAncestorsCsp, isEmbedToken, projectIdFromPreviewSlug } from "@/server/embed-preview";
import { previewUrlFor } from "@/server/service-api.server";

/** Mirrors builder/src/build.ts → projectNameFor() / host-routing.server.ts. */
function pagesProjectName(projectId: string): string {
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

/**
 * Roots whose subdomains are Kimble-claimed slugs (never customer domains).
 * Both are live: the original SaaS root and the current brand root.
 */
const PETAL_ROOTS = ["sites.custardai.dev", "buildwithpetal.com", "kimble.cloud"];

/** Site meta the worker injects into served HTML so each Kimble app gets a
 *  proper title/favicon/social card without the user having to wire it up. */
type SiteMeta = {
  title: string | null;
  description: string | null;
  iconUrl: string | null;
  ogImageUrl: string | null;
};

type Result =
  | { kind: "proxy"; target: string; projectId: string; buildId: string | null; meta: SiteMeta }
  | { kind: "embed"; target: string; frameAncestors: string }
  | { kind: "unpublished" | "private"; projectId: string }
  | { kind: "unknown" };

/**
 * Preview address: the project's latest ready build (the same public
 * pages.dev content). A live embed token for this project narrows framing to
 * its one allowed origin; otherwise the build's default policy applies.
 */
async function previewLookup(projectId: string, embedToken: string | null): Promise<Result> {
  const target = await previewUrlFor(projectId, null);
  if (!target) return { kind: "unknown" };
  let frameAncestors = DEFAULT_FRAME_ANCESTORS;
  if (isEmbedToken(embedToken)) {
    const { data: embed } = await supabaseAdmin
      .from("project_embeds")
      .select("project_id, allowed_origin, expires_at")
      .eq("id", embedToken)
      .maybeSingle();
    if (embed && embed.project_id === projectId && new Date(embed.expires_at).getTime() > Date.now()) {
      frameAncestors = frameAncestorsCsp(embed.allowed_origin);
    }
  }
  return { kind: "embed", target: target.replace(/\/$/, ""), frameAncestors };
}

/** Same list the builder writes into every deploy's _headers. */
const DEFAULT_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://custardai.dev https://*.custardai.dev https://*.lovable.app https://usefuljohn.com https://www.usefuljohn.com https://buildwithpetal.com https://*.buildwithpetal.com http://localhost:* http://127.0.0.1:*;";

async function lookup(host: string, embedToken: string | null = null): Promise<Result> {
  const h = host.toLowerCase().split(":")[0];
  let projectId: string | null = null;

  const root = PETAL_ROOTS.find((r) => h.endsWith(`.${r}`));
  if (root) {
    const slug = h.slice(0, -1 - root.length);
    if (!slug || slug.includes(".")) return { kind: "unknown" };
    // Infrastructure hosts are never project slugs.
    if (slug === "www" || slug === "fallback") return { kind: "unknown" };
    const previewProjectId = root === EMBED_ROOT ? projectIdFromPreviewSlug(slug) : null;
    if (previewProjectId) return previewLookup(previewProjectId, embedToken);
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("subdomain", slug)
      .maybeSingle();
    projectId = project?.id ?? null;
  } else {
    const { data: domain } = await supabaseAdmin
      .from("project_domains")
      .select("project_id, status")
      .eq("hostname", h)
      .maybeSingle();
    projectId = domain?.status === "active" ? domain.project_id : null;
  }

  if (!projectId) return { kind: "unknown" };

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select(
      "id, title, summary, published_visibility, published_build_id, site_title, site_description, site_icon_url, site_og_image_url",
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { kind: "unknown" };

  const visibility = project.published_visibility ?? "unpublished";
  if (visibility === "unpublished") {
    return { kind: "unpublished", projectId: project.id };
  }
  if (visibility === "private") {
    return { kind: "private", projectId: project.id };
  }

  // public — figure out the pages.dev URL.
  let target = `https://${pagesProjectName(project.id)}.pages.dev`;
  if (project.published_build_id) {
    const { data: build } = await supabaseAdmin
      .from("project_builds")
      .select("dist_path, status")
      .eq("id", project.published_build_id)
      .maybeSingle();
    if (build?.status === "ready" && build.dist_path) {
      target = build.dist_path.replace(/\/$/, "");
    }
  }

  // Site meta — site_* columns override, otherwise fall back to the
  // project's build-time title/summary so newly generated apps still get
  // sensible browser-tab text without the user having to fill anything in.
  const meta: SiteMeta = {
    title: project.site_title?.trim() || project.title || null,
    description: project.site_description?.trim() || project.summary || null,
    iconUrl: project.site_icon_url?.trim() || null,
    ogImageUrl: project.site_og_image_url?.trim() || null,
  };

  return { kind: "proxy", target, projectId: project.id, buildId: project.published_build_id ?? null, meta };
}

export const Route = createFileRoute("/api/public/host-lookup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const host = url.searchParams.get("host") ?? "";
        if (!host) {
          return new Response(JSON.stringify({ kind: "unknown" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const embedToken = url.searchParams.get(EMBED_PARAM);
        const result = await lookup(host, embedToken);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            // 60s edge cache — matches the in-memory cache used for custom domains.
            // Embed-token answers are short-lived and never shared-cached.
            "Cache-Control": embedToken ? "private, max-age=30" : "public, max-age=60, s-maxage=60",
          },
        });
      },
    },
  },
});
