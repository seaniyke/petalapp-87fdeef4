/**
 * Autonomous completion worker.
 *
 * Picks up any request whose app is still not usable — build failed, or the
 * browser check found a blocking defect — and runs the next repair round
 * server-side. This is the safety net for the case that used to lose the
 * whole loop: the user closed the tab.
 *
 * The open builder tab gets first refusal (`resume_after` is a short grace
 * window written by the callback), so in the common case this worker finds
 * nothing to do. Budgets live in `project_turn_completion`, so a round claimed
 * here cannot also be spent by the browser.
 *
 * Auth: `x-petal-cron-secret` must match `BUILDER_SHARED_SECRET`.
 * Schedule: every 2 minutes (pg_cron).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { secretsMatch } from "@/server/rate-limit.server";
import {
  claimResumeAttempt,
  listResumable,
  markBlocked,
  INTERRUPTED_MARKER,
  type CompletionRecord,
} from "@/server/turn-completion.server";
import { recoverApplyingCreditPauses } from "@/server/credit-pause.server";

/** Never run more than a couple of repairs per tick — this costs money. */
const MAX_PER_TICK = 3;

function repairBrief(record: CompletionRecord): string {
  // An interrupted request never produced a broken build — it just stopped.
  // Re-run what the user actually asked for, silently.
  if (record.evidence.includes(INTERRUPTED_MARKER)) {
    return record.outstanding_defects[0] ?? "";
  }
  const defects = record.outstanding_defects.slice(0, 10);
  return [
    "Your last build is not usable yet. Kimble's own checks found these problems:",
    ...defects.map((d) => `- ${d}`),
    "",
    "Fix exactly these problems. Change only the files involved, keep everything that already works, and do not restate the plan.",
  ].join("\n");
}

async function loadFiles(projectId: string) {
  const { data } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  return (data ?? []).map((f) => ({ path: f.path, content: f.content }));
}

async function requeueWithoutAttempt(recordId: string, attempts: number): Promise<void> {
  await supabaseAdmin
    .from("project_turn_completion")
    .update({ stage: "needs_repair", attempts, resume_after: new Date(Date.now() + 2 * 60_000).toISOString() } as never)
    .eq("id", recordId)
    .eq("stage", "repairing");
}

export async function resumeOne(record: CompletionRecord, origin: string): Promise<string> {
  // A turn the user stopped is never restarted, however it was queued.
  const { turnAllowsResume, turnStatusOf } = await import("@/server/turn-cancel.server");
  if (!turnAllowsResume(await turnStatusOf(record.turn_id))) {
    await markBlocked(record.id, "Stopped by you — Kimble won't restart it.");
    return "stopped";
  }
  const claimed = await claimResumeAttempt(record);
  if (!claimed) return "skipped";

  // An interrupted FIRST build has no files yet — that's expected, not a
  // reason to stop. Only a repair round genuinely needs existing files.
  const interrupted = record.evidence.includes(INTERRUPTED_MARKER);
  const files = await loadFiles(record.project_id);
  if (!files.length && !interrupted) {
    await markBlocked(record.id, "Kimble could not find the project's files to repair.");
    return "blocked";
  }

  const brief = repairBrief(record);
  if (!brief.trim()) {
    await markBlocked(record.id, "Kimble could not tell what was left to finish.");
    return "blocked";
  }

  // An interrupted first build with saved progress continues from its
  // checkpoint (on the build server) instead of starting from zero.
  const { loadResumableCheckpoint } = await import("@/server/build-checkpoint.server");
  const checkpoint = interrupted && !files.length ? await loadResumableCheckpoint(record.project_id) : null;

  const secret = process.env.BUILDER_SHARED_SECRET!;
  const res = await fetch(new URL("/api/generate", origin).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-petal-internal-secret": secret,
      "x-petal-internal-user": record.user_id,
      ...(checkpoint ? { "x-kimble-durable-dispatch": "1" } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: checkpoint?.request || brief }],
      currentFiles: files,
      projectId: record.project_id,
      isAutoFix: true,
      autoPlan: false,
      autoResumeAttempts: record.attempts + 1,
      ...(checkpoint ? { resumeCheckpointId: checkpoint.id, turnId: crypto.randomUUID() } : {}),
    }),
  });

  // The build server isn't back yet: keep the saved progress and try again on
  // a later tick, without spending an attempt.
  if (checkpoint && (res.status === 503 || res.status === 502)) {
    await requeueWithoutAttempt(record.id, record.attempts);
    return "waiting_for_builder";
  }

  if (!res.ok) {
    await markBlocked(
      record.id,
      `Kimble could not start an automatic repair (${res.status}). Open the project and press Try to fix.`,
    );
    return "failed";
  }

  // Drain the stream so the worker stays alive until the pipeline finishes;
  // the pipeline itself is detached, but draining keeps the invocation honest.
  try {
    await res.text();
  } catch {
    /* the pipeline continues server-side regardless */
  }
  return "resumed";
}

export async function handleTurnResume(request: Request): Promise<Response> {
  const expected = process.env.BUILDER_SHARED_SECRET;
  const provided = request.headers.get("x-petal-cron-secret");
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Memory outbox first: replay any turn whose memory write was lost when
  // its worker ended. Cheap, and guarantees no turn is ever forgotten.
  let memoryReplayed = 0;
  try {
    const { sweepPendingMemories } = await import("@/server/project-memory.server");
    memoryReplayed = await sweepPendingMemories(5);
  } catch (e) {
    console.warn("[cron/turn-resume] memory sweep failed:", (e as Error).message);
  }

  // Partner low-balance email (one per dip below the threshold).
  try {
    const { checkPartnerBalance } = await import("@/server/balance-alert.server");
    const r = await checkPartnerBalance(new URL(request.url).origin);
    if (r.error) console.warn("[cron/turn-resume] balance alert:", r.error);
  } catch (e) {
    console.warn("[cron/turn-resume] balance alert failed:", (e as Error).message);
  }

  let creditPausesRecovered = 0;
  try {
    const recovered = await recoverApplyingCreditPauses(MAX_PER_TICK);
    creditPausesRecovered = recovered.length;
    const secret = process.env.BUILDER_SHARED_SECRET;
    if (secret) {
      const origin = new URL(request.url).origin;
      await Promise.all(recovered.map(async (projectId) => {
        const { data: project } = await supabaseAdmin.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
        if (!project?.owner_id) return;
        await fetch(new URL("/api/builds/trigger", origin), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret, "x-petal-internal-user": project.owner_id },
          body: JSON.stringify({ projectId }),
        }).catch(() => undefined);
      }));
    }
  } catch (e) {
    console.warn("[cron/turn-resume] credit checkpoint sweep failed:", (e as Error).message);
  }

  const pending = await listResumable(MAX_PER_TICK);
  if (!pending.length) {
    return Response.json({ ok: true, checked: 0, resumed: 0, memoryReplayed, creditPausesRecovered });
  }

  const origin = new URL(request.url).origin;
  const results: string[] = [];
  for (const record of pending) {
    try {
      results.push(await resumeOne(record, origin));
    } catch (e) {
      console.error("[cron/turn-resume] round failed", record.id, (e as Error).message);
      await markBlocked(record.id, "An unexpected error stopped the automatic repair.");
      results.push("error");
    }
  }

  console.info(`[cron/turn-resume] ${results.join(",")}`);
  return Response.json({
    ok: true,
    checked: pending.length,
    resumed: results.filter((r) => r === "resumed").length,
  });
}

export const Route = createFileRoute("/api/public/cron/turn-resume")({
  server: {
    handlers: {
      POST: async ({ request }) => handleTurnResume(request),
    },
  },
});
