/**
 * /api/visitors — return visitor + pageview counts for a project's published
 * site, sourced from Cloudflare's GraphQL Analytics API.
 *
 * Auth: bearer token in `Authorization` header. Owner of the project only
 * (matches /api/publish). We don't expose visitor counts to remix viewers.
 *
 * Query params:
 *   - projectId (uuid, required)
 *   - range     (24h | 7d | 30d, optional, default 7d)
 *
 * Response shape: { visitors, pageviews, range, since, until }.
 *
 * Failure mode: when Cloudflare analytics is unreachable or the token is
 * misconfigured, we return 200 with `{ visitors: 0, pageviews: 0,
 * unavailable: true, error }` so the Publish sheet can render a "—" state
 * without breaking. Real auth/ownership errors still return 4xx.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getPagesProjectVisitors,
  type VisitorRange,
} from "@/server/cloudflare-analytics.server";

/** Mirrors `pagesProjectName` in `host-routing.server.ts` and `builder/build.ts`. */
function pagesProjectName(projectId: string): string {
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

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
        const range: VisitorRange = parsed.data.range ?? "7d";

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

        // Nothing has ever been published → no traffic to query. Skip the
        // round-trip to Cloudflare entirely.
        if (!project.published_build_id) {
          return Response.json({
            visitors: 0,
            pageviews: 0,
            range,
            since: null,
            until: null,
            unavailable: false,
            neverPublished: true,
          });
        }

        try {
          const stats = await getPagesProjectVisitors(
            pagesProjectName(projectId),
            range,
          );
          return Response.json({ ...stats, unavailable: false });
        } catch (e) {
          // Soft-fail: analytics outage shouldn't break the Publish sheet.
          // The client renders "—" when `unavailable` is true.
          return Response.json({
            visitors: 0,
            pageviews: 0,
            range,
            since: null,
            until: null,
            unavailable: true,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      },
    },
  },
});
