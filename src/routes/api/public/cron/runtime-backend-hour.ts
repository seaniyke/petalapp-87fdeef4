/**
 * Hourly runtime meter for managed backends.
 *
 * For every active `managed_petal` backend that is NOT paused, charges the
 * project owner 2¢ via the runtime wallet. The `charge_runtime` RPC handles
 * cap enforcement and will flip `projects.runtime_paused = true` when the
 * project's spend cap is exceeded; an upstream cron later actually pauses
 * the Supabase project on the next run.
 *
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: invoke once per hour (pg_cron or external scheduler).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chargeRuntime } from "@/server/runtime-wallet.server";

/** USD cents charged per active backend per hour. */
const BACKEND_HOUR_CENTS = 2;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function runHourlyCharges(): Promise<{
  charged: number;
  blocked: number;
  skipped: number;
}> {
  // Find every active managed backend with an owning project.
  const { data: backends, error } = await supabaseAdmin
    .from("project_backends")
    .select("project_id, status, provider")
    .eq("provider", "managed_petal")
    .eq("status", "ready");
  if (error) throw new Error(`list backends: ${error.message}`);
  if (!backends?.length) return { charged: 0, blocked: 0, skipped: 0 };

  const projectIds = backends.map((b) => b.project_id);
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id, runtime_paused")
    .in("id", projectIds);

  let charged = 0;
  let blocked = 0;
  let skipped = 0;

  for (const p of projects ?? []) {
    if (!p.owner_id) {
      skipped++;
      continue;
    }
    if (p.runtime_paused) {
      skipped++;
      continue;
    }
    const result = await chargeRuntime({
      userId: p.owner_id,
      projectId: p.id,
      meter: "backend_hour",
      cents: BACKEND_HOUR_CENTS,
      metadata: { source: "cron/runtime-backend-hour" },
    });
    if (result.ok) charged++;
    else blocked++;
  }

  return { charged, blocked, skipped };
}

export const Route = createFileRoute("/api/public/cron/runtime-backend-hour")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await runHourlyCharges();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[runtime-hour-cron] failed", msg);
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
          const result = await runHourlyCharges();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
