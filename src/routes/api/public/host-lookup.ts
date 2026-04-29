/**
 * Public hostname → routing target lookup.
 *
 * Called by the edge Worker bound to the SaaS zone to figure out what to do
 * with an incoming request. Handles both Petal subdomains and customer-owned
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

/** Mirrors builder/src/build.ts → projectNameFor() / host-routing.server.ts. */
function pagesProjectName(projectId: string): string {
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

const PETAL_ROOT = "buildwithpetal.com";

type Result =
  | { kind: "proxy"; target: string; projectId: string }
  | { kind: "unpublished" | "private"; projectId: string }
  | { kind: "unknown" };

async function lookup(host: string): Promise<Result> {
  const h = host.toLowerCase().split(":")[0];
  let projectId: string | null = null;

  if (h.endsWith(`.${PETAL_ROOT}`)) {
    const slug = h.slice(0, -1 - PETAL_ROOT.length);
    if (!slug || slug.includes(".")) return { kind: "unknown" };
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
    .select("id, published_visibility, published_build_id")
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
  return { kind: "proxy", target, projectId: project.id };
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
        const result = await lookup(host);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            // 60s edge cache — matches the in-memory cache used for custom domains.
            "Cache-Control": "public, max-age=60, s-maxage=60",
          },
        });
      },
    },
  },
});
