/**
 * Cron endpoint that runs the daily backend-slot housekeeping.
 *
 * What it does, in order:
 *   1. Calls the SQL `expire_backend_slots()` RPC. That marks any slot whose
 *      expires_at has passed as `expired` and flips the corresponding
 *      project_backends row to `paused`.
 *   2. For each freshly-paused managed_petal backend, calls
 *      `pauseForProject` to actually pause the upstream Supabase project.
 *      (The SQL only sets local state — it can't reach the Mgmt API.)
 *   3. For every managed slot expiring within the next 7 / 3 / 1 days,
 *      sends a "Your backend renews soon" reminder email by calling the
 *      send-transactional-email route internally. Idempotency keys keyed off
 *      slotId+threshold ensure we never double-send within the same window.
 *
 * Auth: requires the `x-petal-cron-secret` header to match BUILDER_SHARED_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pauseForProject } from "@/server/managed-backend.server";

const REMINDER_THRESHOLDS_DAYS = [7, 3, 1] as const;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function sendReminderViaInternal(
  origin: string,
  args: {
    email: string;
    daysLeft: number;
    projectId: string;
    projectTitle: string;
    expiresAt: string;
    slotId: string;
  },
): Promise<boolean> {
  const idempotencyKey = `backend-renewal-d${args.daysLeft}-${args.slotId}`;
  const builderSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderSecret) return false;

  const res = await fetch(`${origin}/lovable/email/transactional/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-petal-internal-secret": builderSecret,
    },
    body: JSON.stringify({
      templateName: "backend-renewal-reminder",
      recipientEmail: args.email,
      idempotencyKey,
      templateData: {
        daysLeft: args.daysLeft,
        projectTitle: args.projectTitle,
        expiresAt: args.expiresAt,
        renewUrl: `https://buildwithpetal.com/projects/${args.projectId}`,
      },
    }),
  });
  if (!res.ok) {
    console.warn(
      "[backend-cron] reminder send failed",
      args.slotId,
      res.status,
      await res.text().catch(() => ""),
    );
    return false;
  }
  return true;
}

async function runHousekeeping(origin: string): Promise<{
  expiredPaused: number;
  pausedUpstream: number;
  remindersSent: number;
}> {
  // 1. Run SQL expiry.
  const { error: expErr } = await supabaseAdmin.rpc("expire_backend_slots");
  if (expErr) throw new Error(`expire_backend_slots: ${expErr.message}`);

  // 2. Pause upstream Supabase projects for any backend recently flipped to
  //    'paused' (within the last hour). Idempotent — pauseForProject is a
  //    no-op if upstream is already paused.
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: pausedRows } = await supabaseAdmin
    .from("project_backends")
    .select("project_id")
    .eq("provider", "managed_petal")
    .eq("status", "paused")
    .gte("paused_at", sinceIso);

  let pausedUpstream = 0;
  for (const row of pausedRows ?? []) {
    try {
      await pauseForProject(row.project_id);
      pausedUpstream++;
    } catch (e) {
      console.warn(
        "[backend-cron] pauseForProject failed",
        row.project_id,
        (e as Error).message,
      );
    }
  }

  // 3. Send renewal reminders. For each threshold, find slots whose
  //    expires_at falls in the [now+days, now+days+1) window.
  const nowMs = Date.now();
  let remindersSent = 0;

  for (const days of REMINDER_THRESHOLDS_DAYS) {
    const windowStart = new Date(nowMs + days * 86_400_000).toISOString();
    const windowEnd = new Date(nowMs + (days + 1) * 86_400_000).toISOString();

    const { data: slots, error } = await supabaseAdmin
      .from("backend_slots")
      .select("id, user_id, project_id, expires_at")
      .eq("status", "active")
      .gte("expires_at", windowStart)
      .lt("expires_at", windowEnd);
    if (error) {
      console.warn("[backend-cron] reminder query failed", error.message);
      continue;
    }
    if (!slots?.length) continue;

    const userIds = [...new Set(slots.map((s) => s.user_id))];
    const projectIds = [...new Set(slots.map((s) => s.project_id))];

    // Look up emails via the admin auth API (auth.users isn't queryable directly).
    const userEmailById = new Map<string, string>();
    for (const uid of userIds) {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        const email = data?.user?.email;
        if (email) userEmailById.set(uid, email);
      } catch (e) {
        console.warn("[backend-cron] getUserById failed", uid, (e as Error).message);
      }
    }

    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, title")
      .in("id", projectIds);
    const projectTitleById = new Map(
      (projects ?? []).map((p) => [p.id, p.title as string]),
    );

    for (const slot of slots) {
      const email = userEmailById.get(slot.user_id);
      if (!email) continue;
      const ok = await sendReminderViaInternal(origin, {
        email,
        daysLeft: days,
        projectId: slot.project_id,
        projectTitle:
          projectTitleById.get(slot.project_id) ?? "your project",
        expiresAt: slot.expires_at,
        slotId: slot.id,
      });
      if (ok) remindersSent++;
    }
  }

  return {
    expiredPaused: pausedRows?.length ?? 0,
    pausedUpstream,
    remindersSent,
  };
}

function getOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export const Route = createFileRoute("/api/public/cron/backend-slots")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) {
          console.error("[backend-cron] BUILDER_SHARED_SECRET not set");
          return new Response("Server misconfigured", { status: 500 });
        }
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();

        try {
          const result = await runHousekeeping(getOrigin(request));
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[backend-cron] failed", msg);
          return new Response(msg, { status: 500 });
        }
      },
      // GET allowed for manual trigger / health check (still secret-gated).
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await runHousekeeping(getOrigin(request));
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
