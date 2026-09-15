/**
 * Backfills saved project preview images.
 *
 * Every shipped build should already have its preview captured by the build
 * callback. This sweep catches the leftovers: older projects from before
 * previews were saved, and captures the worker cut short.
 *
 * Auth: `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: every 10 minutes (pg_cron).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { secretsMatch } from "@/server/rate-limit.server";
import { ensureSavedThumbnail } from "@/server/project-thumbnail.server";

/** Screenshots are slow and rate-limited upstream — keep each tick small. */
const MAX_PER_TICK = 4;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function backfill(): Promise<{ captured: number; considered: number }> {
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, published_build_id, latest_build_id, updated_at")
    .not("latest_build_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(250);

  const candidates = projects ?? [];
  if (candidates.length === 0) return { captured: 0, considered: 0 };

  const { data: saved } = await supabaseAdmin
    .from("project_thumbnails")
    .select("project_id, build_id")
    .in(
      "project_id",
      candidates.map((p) => p.id),
    );
  const savedBuild = new Map((saved ?? []).map((row) => [row.project_id, row.build_id]));

  const stale = candidates.filter((p) => {
    const target = p.published_build_id ?? p.latest_build_id;
    if (!savedBuild.has(p.id)) return true;
    return savedBuild.get(p.id) !== target;
  });

  let captured = 0;
  for (const project of stale.slice(0, MAX_PER_TICK)) {
    const target = project.published_build_id ?? project.latest_build_id;
    const result = await ensureSavedThumbnail(project.id, target).catch(() => null);
    if (result) captured += 1;
  }
  return { captured, considered: stale.length };
}

export const Route = createFileRoute("/api/public/cron/thumbnail-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        if (!secretsMatch(request.headers.get("x-petal-cron-secret"), secret)) {
          return unauthorized();
        }
        try {
          return Response.json({ ok: true, ...(await backfill()) });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!secretsMatch(provided, secret)) return unauthorized();
        try {
          return Response.json({ ok: true, ...(await backfill()) });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
        }
      },
    },
  },
});
