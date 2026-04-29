/**
 * /api/visitors — return visitor + pageview counts for a project's published
 * site, sourced from our own `page_views` / `page_views_daily` tables.
 *
 * Auth: bearer token in `Authorization` header. Owner of the project only
 * (matches /api/publish). We don't expose visitor counts to remix viewers.
 *
 * Query params:
 *   - projectId (uuid, required)
 *   - range     (24h | 7d | 30d, optional, default 7d)
 *
 * Response shape (kept stable for the Publish sheet):
 *   { visitors, pageviews, range, since, until, unavailable: false }
 *
 * Data source: `get_project_pageview_stats(_project_id)` RPC. The beacon
 * injected by the subdomain Worker into every served HTML page calls
 * `/api/public/track`, which writes into `page_views` and the daily rollup.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Range = "24h" | "7d" | "30d";

const QuerySchema = z.object({
  projectId: z.string().uuid(),
  range: z.enum(["24h", "7d", "30d"]).optional(),
});

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

function rangeWindow(range: Range): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  if (range === "24h") since.setUTCHours(since.getUTCHours() - 24);
  else if (range === "7d") since.setUTCDate(since.getUTCDate() - 7);
  else since.setUTCDate(since.getUTCDate() - 30);
  return { since: since.toISOString(), until: until.toISOString() };
}

export const Route = createFileRoute("/api/visitors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const userId = userIdOrResp;

        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({
          projectId: url.searchParams.get("projectId") ?? undefined,
          range: url.searchParams.get("range") ?? undefined,
        });
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid query" },
            { status: 400 },
          );
        }
        const { projectId } = parsed.data;
        const range: Range = parsed.data.range ?? "7d";

        // Ownership check.
        const { data: project, error: projErr } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id, published_visibility, published_build_id")
          .eq("id", projectId)
          .maybeSingle();
        if (projErr) {
          return Response.json(
            { error: `Could not load project: ${projErr.message}` },
            { status: 500 },
          );
        }
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        if (project.owner_id !== userId) {
          return Response.json(
            { error: "Not authorized to view this project's analytics" },
            { status: 403 },
          );
        }

        const { since, until } = rangeWindow(range);

        // Nothing has ever been published → no traffic to count.
        if (!project.published_build_id) {
          return Response.json({
            visitors: 0,
            pageviews: 0,
            range,
            since,
            until,
            unavailable: false,
            neverPublished: true,
          });
        }

        const { data, error } = await supabaseAdmin.rpc(
          "get_project_pageview_stats",
          { _project_id: projectId },
        );
        if (error) {
          return Response.json({
            visitors: 0,
            pageviews: 0,
            range,
            since,
            until,
            unavailable: true,
            error: error.message,
          });
        }

        const row = Array.isArray(data) ? data[0] : data;
        const pageviews =
          range === "24h"
            ? Number(row?.views_24h ?? 0)
            : range === "30d"
              ? Number(row?.views_30d ?? 0)
              : Number(row?.views_7d ?? 0);
        const visitors =
          range === "30d"
            ? Number(row?.visitors_30d ?? 0)
            : Number(row?.visitors_7d ?? 0);

        return Response.json({
          visitors,
          pageviews,
          range,
          since,
          until,
          unavailable: false,
        });
      },
    },
  },
});
