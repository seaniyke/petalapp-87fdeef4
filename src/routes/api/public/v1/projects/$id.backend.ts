/**
 * Partner API — Shared Cloud backend status, metering and pause/resume.
 *   GET  /api/public/v1/projects/:id/backend[?from=YYYY-MM-DD&to=YYYY-MM-DD]
 *        → { backend, paused, pauseReason, pauseReasons, graceUntil, dailyCredits,
 *            monthlyCreditsEstimate, lastActiveAt, usage, activity }
 *        `pauseReasons` lists every reason ("partner", "billing"); `pauseReason`
 *        is "partner" | "billing" | "both" | null. `activity` lists each charged
 *        day in the range (default: last 30 days, max 366).
 *   POST /api/public/v1/projects/:id/backend  { "action": "pause" | "resume" }
 *        Pausing stops sign-in, sign-up and data for that site; its pages stay online.
 *        Resume lifts the partner pause. A billing pause lifts itself once the
 *        account has a day of credits; resume also lifts it straight away then.
 * Service key + project ownership required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, serviceUserId, verifyApiCaller } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({ action: z.enum(["pause", "resume"]) });

/** Validated inclusive date range; null when the query is malformed. */
export function activityRange(url: URL, now = new Date()): { from: string; to: string } | null {
  const today = now.toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? today;
  const fallbackFrom = new Date(`${to}T00:00:00Z`);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - 29);
  const from = url.searchParams.get("from") ?? (DATE.test(to) ? fallbackFrom.toISOString().slice(0, 10) : "");
  if (!DATE.test(from) || !DATE.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || (b - a) / 86_400_000 > 365) return null;
  return { from, to };
}

async function status(projectId: string, range: { from: string; to: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getSharedBackend, sharedUsage } = await import("@/server/shared-backend.server");
  const { pauseReasonOf, pauseReasonsOf } = await import("@/server/shared-cloud-pause.server");
  const { economicsValues } = await import("@/server/economics-config.server");
  const { projectActiveDays } = await import("@/server/service-billing.server");
  const owner = await serviceUserId();
  const [backend, { data: proj }, { data: sb }, v, activity] = await Promise.all([
    getSharedBackend(projectId),
    supabaseAdmin
      .from("projects")
      .select("runtime_paused, partner_paused, runtime_grace_until")
      .eq("id", projectId)
      .maybeSingle(),
    supabaseAdmin.from("shared_backends").select("last_active_at").eq("project_id", projectId).maybeSingle(),
    economicsValues(),
    projectActiveDays(owner, projectId, range.from, range.to),
  ]);
  const daily = v.cloud_shared_daily_credits;
  const reasons = pauseReasonsOf(proj ?? {});
  return {
    backend: backend ? "shared" : "none",
    paused: reasons.length > 0,
    pauseReason: pauseReasonOf(proj ?? {}),
    pauseReasons: reasons,
    graceUntil: proj?.runtime_grace_until ?? null,
    dailyCredits: daily,
    monthlyCreditsEstimate: Math.round(daily * 30 * 100) / 100,
    billing: "Charged per active day (any sign-in or data request in the 24 hours before the daily charge). Idle days are free.",
    lastActiveAt: (sb as { last_active_at?: string | null } | null)?.last_active_at ?? null,
    usage: backend ? await sharedUsage(projectId) : { rows: 0, users: 0, collections: [] },
    activity,
  };
}

export const Route = createFileRoute("/api/public/v1/projects/$id/backend")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const range = activityRange(new URL(request.url));
        if (!range) return json({ error: "bad_range", expected: "from/to as YYYY-MM-DD, from <= to, at most 366 days" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        return json(await status(params.id, range));
      },
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", expected: { action: "pause | resume" } }, 400);
        const range = activityRange(new URL(request.url))!;
        const pause = await import("@/server/shared-cloud-pause.server");
        if (parsed.data.action === "pause") {
          await pause.pauseForPartner(params.id);
          return json({ ok: true, ...(await status(params.id, range)) });
        }
        const current = await status(params.id, range);
        if (current.pauseReasons.includes("partner")) await pause.resumeForPartner(params.id);
        if (current.pauseReasons.includes("billing")) {
          const { checkCreditBalance } = await import("@/server/credits.server");
          const bal = await checkCreditBalance({ userId: await serviceUserId(), amount: current.dailyCredits });
          if (bal.ok) await pause.resumeFromBilling(params.id);
          else if (!current.pauseReasons.includes("partner")) {
            return json({ error: "insufficient_credits", message: "Top up credits to resume this backend." }, 402);
          }
        }
        return json({ ok: true, ...(await status(params.id, range)) });
      },
    },
  },
});
