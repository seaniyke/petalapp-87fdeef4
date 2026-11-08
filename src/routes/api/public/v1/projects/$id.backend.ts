/**
 * Partner API — Shared Cloud backend status, metering and pause/resume.
 *   GET  /api/public/v1/projects/:id/backend
 *        → { backend, paused, pauseReason, graceUntil, dailyCredits, monthlyCreditsEstimate,
 *            lastActiveAt, usage: { rows, users, collections } }
 *   POST /api/public/v1/projects/:id/backend  { "action": "pause" | "resume" }
 *        Pausing stops sign-in, sign-up and data for that site; its pages stay online.
 *        Resume after an unpaid pause needs one day of credits on the account.
 * Service key + project ownership required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, serviceUserId, verifyServiceKey } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({ action: z.enum(["pause", "resume"]) });

async function status(projectId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getSharedBackend, sharedUsage } = await import("@/server/shared-backend.server");
  const { pauseReasonOf } = await import("@/server/shared-cloud-pause.server");
  const { economicsValues } = await import("@/server/economics-config.server");
  const [backend, { data: proj }, { data: sb }, v] = await Promise.all([
    getSharedBackend(projectId),
    supabaseAdmin.from("projects").select("runtime_paused, runtime_grace_until").eq("id", projectId).maybeSingle(),
    supabaseAdmin.from("shared_backends").select("last_active_at").eq("project_id", projectId).maybeSingle(),
    economicsValues(),
  ]);
  const daily = v.cloud_shared_daily_credits;
  return {
    backend: backend ? "shared" : "none",
    paused: !!proj?.runtime_paused,
    pauseReason: pauseReasonOf(proj ?? {}),
    graceUntil: proj?.runtime_grace_until ?? null,
    dailyCredits: daily,
    monthlyCreditsEstimate: Math.round(daily * 30 * 100) / 100,
    billing: "Charged per active day (any sign-in or data request in the last 24 hours). Idle days are free.",
    lastActiveAt: (sb as { last_active_at?: string | null } | null)?.last_active_at ?? null,
    usage: backend ? await sharedUsage(projectId) : { rows: 0, users: 0, collections: [] },
  };
}

export const Route = createFileRoute("/api/public/v1/projects/$id/backend")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id))) return json({ error: "not_found" }, 404);
        return json(await status(params.id));
      },
      POST: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id))) return json({ error: "not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", expected: { action: "pause | resume" } }, 400);
        const pause = await import("@/server/shared-cloud-pause.server");
        if (parsed.data.action === "pause") {
          await pause.pauseForPartner(params.id);
        } else {
          const current = await status(params.id);
          if (current.pauseReason === "billing") {
            const { checkCreditBalance } = await import("@/server/credits.server");
            const bal = await checkCreditBalance({ userId: await serviceUserId(), amount: current.dailyCredits });
            if (!bal.ok) return json({ error: "insufficient_credits", message: "Top up credits to resume this backend." }, 402);
          }
          await pause.resumeBackend(params.id);
        }
        return json({ ok: true, ...(await status(params.id)) });
      },
    },
  },
});
