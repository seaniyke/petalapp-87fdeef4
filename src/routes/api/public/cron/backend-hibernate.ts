/**
 * Hibernation cron for idle managed backends.
 *
 * Dedicated Supabase projects cost money even when no one is using them.
 * This cron pauses any managed_petal backend that has not received a status
 * check or usage signal in the last 7 days. Paused projects retain their data
 * and can be restored on the next user request.
 *
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: invoke once per day (pg_cron or external scheduler).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pauseForProject } from "@/server/managed-backend.server";

/** Idle threshold: 7 days without a status/usage signal. */
const IDLE_DAYS = 7;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function hibernateIdleBackends(): Promise<{
  checked: number;
  paused: number;
  skipped: number;
  errors: number;
}> {
  const idleThreshold = new Date(
    Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Targets: ready managed backends whose last_active_at is old or null.
  const { data: backends, error } = await supabaseAdmin
    .from("project_backends")
    .select("project_id, last_active_at, status")
    .eq("provider", "managed_petal")
    .eq("status", "ready")
    .or(`last_active_at.lt.${idleThreshold},last_active_at.is.null`);
  if (error) throw new Error(`list backends: ${error.message}`);

  let paused = 0;
  let skipped = 0;
  let errors = 0;

  for (const b of backends ?? []) {
    // Defensive: only pause if still idle at the moment we process it.
    const lastActive = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
    if (lastActive && lastActive > Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000) {
      skipped++;
      continue;
    }

    try {
      await pauseForProject(b.project_id);
      await supabaseAdmin
        .from("project_backends")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          error_message: "Paused after 7 days of inactivity. Top up to bring it back online.",
        })
        .eq("project_id", b.project_id);
      await supabaseAdmin
        .from("projects")
        .update({ runtime_paused: true })
        .eq("id", b.project_id);
      paused++;
    } catch (e) {
      errors++;
      console.warn(
        "[hibernate] pauseForProject failed",
        b.project_id,
        (e as Error).message,
      );
    }
  }

  return { checked: backends?.length ?? 0, paused, skipped, errors };
}

export const Route = createFileRoute("/api/public/cron/backend-hibernate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await hibernateIdleBackends();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[hibernate-cron] failed", msg);
          return new Response(msg, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await hibernateIdleBackends();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
