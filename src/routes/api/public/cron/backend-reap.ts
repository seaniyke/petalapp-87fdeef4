/**
 * Reaper for dedicated databases nobody came back to.
 *
 * A dedicated Supabase project costs money for as long as it exists — even
 * paused. Hibernation pauses an unused one after 7 days; this job finishes the
 * job: after the retention window (default 30 days paused) the upstream
 * project is exported and deleted, and the app falls back to the shared
 * database. Owners are emailed a week before deletion.
 *
 * Only backends paused for being idle are reaped. A backend paused because the
 * owner ran out of credits is theirs to bring back by topping up.
 *
 * Auth: `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 * Schedule: once per day.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deleteForProject } from "@/server/managed-backend.server";
import { economicsValue } from "@/server/economics-config.server";
import { secretsMatch } from "@/server/rate-limit.server";

const WARN_DAYS_BEFORE = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function ownerEmail(projectId: string): Promise<{ email: string; title: string } | null> {
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("title, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.owner_id) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", project.owner_id)
    .maybeSingle();
  const email = (profile as { email?: string } | null)?.email;
  if (!email) return null;
  return { email, title: project.title ?? "your app" };
}

async function warn(projectId: string, daysLeft: number): Promise<boolean> {
  const who = await ownerEmail(projectId);
  if (!who) return false;
  const subject = `${who.title}: database removal in ${daysLeft} days`;
  const body =
    `${who.title} hasn't been used in a while, so its dedicated database is paused.\n\n` +
    `If it stays unused we'll remove it in ${daysLeft} days and the app will keep running on Petal's shared database. ` +
    `Open the app before then and the database wakes up automatically — nothing is lost.`;
  try {
    const { error } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: `backend-reap-${projectId}`,
        to: who.email,
        from: "Petal AI <noreply@buildwithpetal.com>",
        sender_domain: "notify.buildwithpetal.com",
        subject,
        html: `<p>${body.replace(/\n\n/g, "</p><p>")}</p>`,
        text: body,
        purpose: "transactional",
        label: "backend_reap_warning",
        idempotency_key: `backend-reap-${projectId}`,
        queued_at: new Date().toISOString(),
      },
    });
    return !error;
  } catch {
    return false;
  }
}

async function reap(): Promise<{
  checked: number;
  warned: number;
  deleted: number;
  errors: number;
}> {
  const retentionDays = await economicsValue("dedicated_retention_days");
  const now = Date.now();

  const { data: rows, error } = await supabaseAdmin
    .from("project_backends")
    .select("project_id, paused_at, pause_reason, delete_warned_at")
    .eq("provider", "managed_petal")
    .eq("status", "paused")
    .eq("pause_reason", "idle");
  if (error) throw new Error(`list paused backends: ${error.message}`);

  let warned = 0;
  let deleted = 0;
  let errors = 0;

  for (const row of rows ?? []) {
    const pausedAt = row.paused_at ? new Date(row.paused_at).getTime() : null;
    if (!pausedAt) continue;
    const daysPaused = (now - pausedAt) / DAY_MS;

    try {
      if (daysPaused >= retentionDays) {
        await deleteForProject(row.project_id);
        deleted++;
      } else if (
        daysPaused >= retentionDays - WARN_DAYS_BEFORE &&
        !row.delete_warned_at
      ) {
        const sent = await warn(row.project_id, Math.ceil(retentionDays - daysPaused));
        await supabaseAdmin
          .from("project_backends")
          .update({ delete_warned_at: new Date().toISOString() })
          .eq("project_id", row.project_id);
        if (sent) warned++;
      }
    } catch (e) {
      errors++;
      console.warn("[backend-reap] failed", row.project_id, (e as Error).message);
    }
  }

  return { checked: rows?.length ?? 0, warned, deleted, errors };
}

export const Route = createFileRoute("/api/public/cron/backend-reap")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        if (!secretsMatch(request.headers.get("x-petal-cron-secret"), secret)) {
          return unauthorized();
        }
        try {
          return Response.json({ ok: true, ...(await reap()) });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!secretsMatch(provided, secret)) return unauthorized();
        try {
          return Response.json({ ok: true, ...(await reap()) });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
        }
      },
    },
  },
});
