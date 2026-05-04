/**
 * Hourly runtime meter for managed backends.
 *
 * For every active `managed_petal` backend that is NOT paused:
 *   1. Charges the project owner 2¢ via the runtime wallet. The
 *      `charge_runtime` RPC handles cap enforcement, sets a 48h
 *      `runtime_grace_until` window when the wallet is empty, and clears
 *      it on a successful charge.
 *   2. After charging, any backend whose grace window has now expired
 *      (i.e. wallet still empty 48h after the first shortfall) is paused
 *      upstream via `pauseForProject` and `projects.runtime_paused` is set.
 *
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: invoke once per hour (pg_cron or external scheduler).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chargeRuntime } from "@/server/runtime-wallet.server";
import { pauseForProject } from "@/server/managed-backend.server";

/** USD cents charged per active backend per hour. 4¢/hr ≈ $29/mo full-time;
 * underlying managed Supabase costs ~$10/mo so we keep ~65% margin. */
const BACKEND_HOUR_CENTS = 4;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function runHourlyCharges(): Promise<{
  charged: number;
  blocked: number;
  skipped: number;
  pausedExpired: number;
}> {
  // Find every active managed backend with an owning project.
  const { data: backends, error } = await supabaseAdmin
    .from("project_backends")
    .select("project_id, status, provider")
    .eq("provider", "managed_petal")
    .eq("status", "ready");
  if (error) throw new Error(`list backends: ${error.message}`);
  if (!backends?.length) {
    return { charged: 0, blocked: 0, skipped: 0, pausedExpired: 0 };
  }

  const projectIds = backends.map((b) => b.project_id);
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id, runtime_paused, runtime_grace_until")
    .in("id", projectIds);

  let charged = 0;
  let blocked = 0;
  let skipped = 0;
  let pausedExpired = 0;
  const nowMs = Date.now();

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
    if (result.ok) {
      charged++;
      continue;
    }
    blocked++;

    // After a failed charge, re-read grace window and pause if expired.
    const { data: fresh } = await supabaseAdmin
      .from("projects")
      .select("runtime_grace_until")
      .eq("id", p.id)
      .maybeSingle();
    const graceUntil = fresh?.runtime_grace_until
      ? new Date(fresh.runtime_grace_until).getTime()
      : null;
    if (graceUntil != null && graceUntil <= nowMs) {
      try {
        await pauseForProject(p.id);
        await supabaseAdmin
          .from("projects")
          .update({ runtime_paused: true })
          .eq("id", p.id);
        await supabaseAdmin
          .from("project_backends")
          .update({ status: "paused", paused_at: new Date().toISOString() })
          .eq("project_id", p.id);
        pausedExpired++;
      } catch (e) {
        console.warn(
          "[runtime-hour-cron] pauseForProject failed",
          p.id,
          (e as Error).message,
        );
      }
    }
  }

  return { charged, blocked, skipped, pausedExpired };
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
