/**
 * Liveness ping from the build service.
 *
 * A build is never stopped for taking a long time — only for going silent.
 * The build service posts here on a fixed cadence with a plain-language label
 * of what it is doing right now ("installing dependencies", "opening /pricing").
 * The stale-run sweepers measure quiet time from `last_progress_at`, so a build
 * that keeps reporting progress keeps running, however long it takes.
 *
 * URL: /api/public/builds/heartbeat (under /api/public/* so platform auth does
 *      not shield it from the build service). Signed with the same HMAC scheme
 *      as the build callback.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifySignature } from "@/server/builder.server";

const HeartbeatSchema = z.object({
  buildId: z.string().uuid(),
  projectId: z.string().uuid(),
  label: z.string().max(200).optional(),
});

export async function handleBuildHeartbeat(request: Request): Promise<Response> {
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!sharedSecret) return new Response("Server misconfigured", { status: 500 });

  const rawBody = await request.text();
  if (
    !verifySignature(
      sharedSecret,
      rawBody,
      request.headers.get("x-petal-timestamp"),
      request.headers.get("x-petal-signature"),
    )
  ) {
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const result = HeartbeatSchema.safeParse(parsed);
  if (!result.success) return new Response("Invalid body", { status: 400 });
  const { buildId, projectId, label } = result.data;

  const now = new Date().toISOString();

  // Only active builds are touched: a heartbeat must never resurrect or
  // rewrite a build that already reached a terminal state.
  const { data: build } = await supabaseAdmin
    .from("project_builds")
    .update({ last_progress_at: now, progress_label: label ?? null })
    .eq("id", buildId)
    .eq("project_id", projectId)
    .in("status", ["pending", "building"])
    .select("id")
    .maybeSingle();

  // Keep the owning turn alive too, so a long build cannot be reaped from the
  // turn side while the build side is visibly working.
  await supabaseAdmin
    .from("turns")
    .update({ last_progress_at: now, progress_label: label ?? null })
    .eq("project_id", projectId)
    .eq("status", "running");

  return Response.json({ ok: true, tracked: Boolean(build) });
}

export const Route = createFileRoute("/api/public/builds/heartbeat")({
  server: {
    handlers: {
      POST: ({ request }) => handleBuildHeartbeat(request),
    },
  },
});
