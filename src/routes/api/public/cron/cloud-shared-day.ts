/**
 * Daily meter for Kimble Shared Cloud.
 *
 * Every app on the shared database that was active in the last 24 hours is
 * charged the flat Shared Cloud rate (`cloud_shared_daily_credits`, 0.55/day).
 * Out of credits past the 48h grace → backend paused (pages stay up); paused
 * apps resume automatically once the owner has credits again. Kimble's cost is
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
  const { graceExpired, pauseForBilling, resumeFromBilling } = await import("@/server/shared-cloud-pause.server");
  const { checkCreditBalance } = await import("@/server/credits.server");
  const summary = { active: ids.length, charged: 0, blocked: 0, skipped: 0, credits: 0, paused: 0, resumed: 0 };

  // 1. Auto-resume: apps paused for unpaid Shared Cloud come back as soon as
  //    the owner has credits for a day again. Only the billing pause is
  //    lifted; a partner pause stays until the partner resumes it.
  const { data: billingPaused } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id")
    .eq("runtime_paused", true)
    .eq("backend_type", "shared");
  const daily = (await (await import("@/server/economics-config.server")).economicsValues()).cloud_shared_daily_credits;
  for (const p of billingPaused ?? []) {
    if (!p.owner_id) continue;
    const bal = await checkCreditBalance({ userId: p.owner_id, amount: daily });
    if (bal.ok) {
      await resumeFromBilling(p.id);
      summary.resumed++;
    }
  }

  if (!ids.length) return summary;
  const [{ data: projects }, { data: dedicated }, { data: compute }] = await Promise.all([
    supabaseAdmin.from("projects").select("id, owner_id, runtime_paused, partner_paused, runtime_grace_until").in("id", ids),
    supabaseAdmin.from("project_backends").select("project_id").in("project_id", ids).eq("status", "ready").eq("provider", "managed_petal"),
    supabaseAdmin.from("project_compute").select("project_id").in("project_id", ids).neq("status", "deleted"),
  ]);
  const elsewhere = new Set([...(dedicated ?? []), ...(compute ?? [])].map((r) => String(r.project_id)));
  for (const p of projects ?? []) {
    if (!p.owner_id || p.runtime_paused || p.partner_paused || elsewhere.has(p.id)) {
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
    } else {
      summary.blocked++;
      // 2. Out of credits past the 48h grace → pause sign-in and data.
      //    (chargeRuntime opens the grace window on the first failure.)
      if (graceExpired(p.runtime_grace_until)) {
        await pauseForBilling(p.id);
        summary.paused++;
      }
    }
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
