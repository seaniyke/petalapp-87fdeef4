/**
 * Hourly meter for Kimble Compute containers.
 *
 * For every container that is awake:
 *   1. work out whole hours of uptime since the last settlement,
 *   2. charge those hours to the owner's Kimble Credits through the
 *      runtime meter (`compute_hour`), which enforces spend caps,
 *   3. move `billed_through` forward by exactly what was charged.
 *
 * A container that is asleep is never billed. A container whose owner has run
 * out of credits is put to sleep rather than deleted, so nothing is lost.
 * Idle containers are slept; long-abandoned ones are removed.
 *
 * Auth: `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: once per hour.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  chargeCloud,
  cloudRates,
  priceExternal,
  railwayWindowCosts,
  readRailwayUsage,
} from "@/server/cloud-metering.server";
import { secretsMatch } from "@/server/rate-limit.server";
import {
  COMPUTE_IDLE_MS,
  COMPUTE_REAP_MS,
  destroyCompute,
  hoursOwed,
  listBillableCompute,
  markBilled,
  sleepCompute,
} from "@/server/compute.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Summary = { charged: number; hours: number; slept: number; blocked: number; reaped: number };

async function runComputeHour(): Promise<Summary> {
  const rates = await cloudRates();
  const rows = await listBillableCompute();
  const now = Date.now();
  const summary: Summary = { charged: 0, hours: 0, slept: 0, blocked: 0, reaped: 0 };

  for (const row of rows) {
    const hours = hoursOwed(row, now);
    if (hours > 0) {
      const from = row.billedThrough ?? row.awakeSince;
      // Measured Railway usage for exactly the window being settled; falls
      // back to the configured hourly estimate (ESTIMATED) if unreadable.
      const toIso = new Date(Date.parse(from!) + hours * 3_600_000).toISOString();
      const usage = row.serviceId ? await readRailwayUsage(row.serviceId, from!, toIso) : null;
      const priced = priceExternal(railwayWindowCosts(usage, hours, rates), rates);
      const charge = await chargeCloud({
        userId: row.ownerId,
        projectId: row.projectId,
        meter: "compute_hour",
        provider: "railway",
        windowRef: `railway:${row.projectId}:${from}:${hours}`,
        priced,
        metadata: { hours, measured: usage != null },
      });
      if (charge.ok) {
        if (from) await markBilled(row.projectId, hours, from);
        summary.charged += 1;
        summary.hours += hours;
      } else {
        // No balance or a cap was hit: stop the meter by sleeping the
        // container. Nothing is deleted and no unpaid time accrues.
        summary.blocked += 1;
        await sleepCompute(row.projectId);
        summary.slept += 1;
        continue;
      }
    }

    const lastActive = row.lastActiveAt ? Date.parse(row.lastActiveAt) : 0;
    if (lastActive && now - lastActive > COMPUTE_IDLE_MS) {
      await sleepCompute(row.projectId);
      summary.slept += 1;
    }
  }

  // Remove containers that have been asleep long enough to be abandoned.
  const cutoff = new Date(now - COMPUTE_REAP_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("project_compute")
    .select("project_id")
    .eq("status", "sleeping")
    .lt("updated_at", cutoff)
    .limit(10);
  for (const s of stale ?? []) {
    await destroyCompute(String(s.project_id));
    summary.reaped += 1;
  }

  return summary;
}

export const Route = createFileRoute("/api/public/cron/compute-hour")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-petal-cron-secret") ?? "";
        const expected = process.env["BUILDER_SHARED_SECRET"] ?? "";
        if (!expected || !secretsMatch(secret, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const summary = await runComputeHour();
          return Response.json({ ok: true, ...summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown error";
          console.error("[cron/compute-hour] failed", err);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
