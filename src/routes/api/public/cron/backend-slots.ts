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
 *   3. For every managed slot expiring within the next 7 days, sends a
 *      "Your backend renews soon" reminder email, deduplicated by the day
 *      bucket so we don't double-send if the cron runs multiple times.
 *
 * Auth: requires the `x-petal-cron-secret` header to match BUILDER_SHARED_SECRET
 * (we reuse the existing shared secret rather than introducing a new one).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pauseForProject } from "@/server/managed-backend.server";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { render } from "@react-email/components";
import React from "react";

const REMINDER_THRESHOLDS_DAYS = [7, 3, 1] as const;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function enqueueReminderEmail(args: {
  userId: string;
  email: string;
  daysLeft: number;
  projectId: string;
  projectTitle: string;
  expiresAt: string;
  slotId: string;
}): Promise<void> {
  const idempotencyKey = `backend-renewal-reminder-${args.slotId}-d${args.daysLeft}`;

  // Don't double-send: skip if any prior log row exists for this key.
  const { data: existing } = await supabaseAdmin
    .from("email_send_log")
    .select("id")
    .eq("message_id", idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const entry = TEMPLATES["backend-renewal-reminder"];
  if (!entry) {
    console.error("[backend-cron] template missing");
    return;
  }
  const templateData = {
    daysLeft: args.daysLeft,
    projectTitle: args.projectTitle,
    expiresAt: args.expiresAt,
    renewUrl: `https://buildwithpetal.com/projects/${args.projectId}`,
  };
  const subject =
    typeof entry.subject === "function"
      ? entry.subject(templateData)
      : entry.subject;
  const Component = entry.component;
  const element = React.createElement(Component, templateData);
  const html = await render(element);
  const text = await render(element, { plainText: true });

  await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      to: args.email,
      subject,
      html,
      text,
      template_name: "backend-renewal-reminder",
      message_id: idempotencyKey,
      // Lets the dispatcher record the recipient + fan-in to email_send_log.
      user_id: args.userId,
    },
  });
}

async function runHousekeeping(): Promise<{
  expired: number;
  pausedUpstream: number;
  remindersSent: number;
}> {
  // 1. Run SQL expiry.
  const { error: expErr } = await supabaseAdmin.rpc("expire_backend_slots");
  if (expErr) throw new Error(`expire_backend_slots: ${expErr.message}`);

  // 2. Pause upstream Supabase projects for any backend now in 'paused'
  //    state but whose paused_at is recent (last hour) — gives us an idempotent
  //    way to find rows that need an upstream pause.
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

  // 3. Send renewal reminders. We look at active slots whose expires_at falls
  //    within (today + days, today + days + 1) for each threshold.
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

    // Pull the email + project title in one round-trip each.
    const userIds = [...new Set(slots.map((s) => s.user_id))];
    const projectIds = [...new Set(slots.map((s) => s.project_id))];

    // We can't read auth.users directly via the JS client, so we use the
    // admin auth API.
    const userEmailById = new Map<string, string>();
    for (const uid of userIds) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(uid);
      const email = userData?.user?.email;
      if (email) userEmailById.set(uid, email);
    }

    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, title")
      .in("id", projectIds);
    const projectTitleById = new Map(
      (projects ?? []).map((p) => [p.id, p.title]),
    );

    for (const slot of slots) {
      const email = userEmailById.get(slot.user_id);
      if (!email) continue;
      try {
        await enqueueReminderEmail({
          userId: slot.user_id,
          email,
          daysLeft: days,
          projectId: slot.project_id,
          projectTitle:
            projectTitleById.get(slot.project_id) ?? "your project",
          expiresAt: slot.expires_at,
          slotId: slot.id,
        });
        remindersSent++;
      } catch (e) {
        console.warn(
          "[backend-cron] reminder send failed",
          slot.id,
          (e as Error).message,
        );
      }
    }
  }

  return {
    expired: pausedRows?.length ?? 0,
    pausedUpstream,
    remindersSent,
  };
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
          const result = await runHousekeeping();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[backend-cron] failed", msg);
          return new Response(msg, { status: 500 });
        }
      },
      // Allow GET for easy manual trigger / health check (still secret-gated).
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await runHousekeeping();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
