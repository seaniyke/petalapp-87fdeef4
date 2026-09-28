/**
 * Daily meter for Kimble Shared Cloud.
 *
 * Every app on the shared database that was active in the last 24 hours is
 * charged 24 hours of Shared Cloud: 50% below what the same app would pay on
 * the smallest dedicated database (src/lib/cloud-pricing.ts). Kimble's cost is
 * ALLOCATED from the shared bill by stored rows, or UNKNOWN when no bill is
 * entered. Apps already on a dedicated database or their own server are
 * billed by their own meters, never here. Idempotent per project per day.
 *
 * Auth: `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: once per day.
 */
import { createFileRoute } from "@tanstack/react-router";
import { secretsMatch } from "@/server/rate-limit.server";

async function runSharedDay() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { chargeCloud, cloudRates, sharedWindowPrice } = await import("@/server/cloud-metering.server");
  const rates = await cloudRates();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const day = new Date().toISOString().slice(0, 10);
  const { data: active } = await supabaseAdmin
    .from("shared_backends")
    .select("project_id")
    .gte("last_active_at", since);
  const ids = (active ?? []).map((r) => String(r.project_id));
  const summary = { active: ids.length, charged: 0, blocked: 0, skipped: 0, credits: 0 };
  if (!ids.length) return summary;
  const [{ data: projects }, { data: dedicated }, { data: compute }] = await Promise.all([
    supabaseAdmin.from("projects").select("id, owner_id, runtime_paused").in("id", ids),
    supabaseAdmin.from("project_backends").select("project_id").in("project_id", ids).eq("status", "ready").eq("provider", "managed_petal"),
    supabaseAdmin.from("project_compute").select("project_id").in("project_id", ids).neq("status", "deleted"),
  ]);
  const elsewhere = new Set([...(dedicated ?? []), ...(compute ?? [])].map((r) => String(r.project_id)));
  for (const p of projects ?? []) {
    if (!p.owner_id || p.runtime_paused || elsewhere.has(p.id)) {
      summary.skipped++;
      continue;
    }
    const priced = await sharedWindowPrice(p.id, 24, rates);
    const res = await chargeCloud({
      userId: p.owner_id,
      projectId: p.id,
      meter: "cloud_shared",
      provider: "cloud",
      windowRef: `shared:${p.id}:${day}`,
      priced,
      metadata: { source: "cron/cloud-shared-day", day },
    });
    if (res.ok) {
      summary.charged++;
      summary.credits += res.paidWithCredits ?? 0;
    } else summary.blocked++;
  }
  return summary;
}

export const Route = createFileRoute("/api/public/cron/cloud-shared-day")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["BUILDER_SHARED_SECRET"] ?? "";
        const secret = request.headers.get("x-petal-cron-secret") ?? "";
        if (!expected || !secretsMatch(secret, expected)) return new Response("Unauthorized", { status: 401 });
        try {
          return Response.json({ ok: true, ...(await runSharedDay()) });
        } catch (err) {
          console.error("[cron/cloud-shared-day] failed", err);
          return Response.json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
        }
      },
    },
  },
});
