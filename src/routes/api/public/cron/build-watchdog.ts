/**
 * Server-side rescue for builds the build service never picked up.
 *
 * The browser watchdog only runs while the builder tab is open. If the user
 * navigates away or locks their phone, a build that the builder silently
 * dropped used to sit until the stalled-build reaper failed it with
 * "The build service stopped responding." This worker retries it instead,
 * with the same retry budget and the same atomic claim, so a dropped build
 * heals itself with nobody watching.
 *
 * Auth: `x-petal-cron-secret` must match `BUILDER_SHARED_SECRET`.
 * Schedule: every minute (pg_cron).
 */
import { createFileRoute } from "@tanstack/react-router";
import { secretsMatch } from "@/server/rate-limit.server";
import { listStalledBuilds, retryStalledBuild } from "@/server/build-retry.server";
import { fetchBuilderActive, reconcileStalledBuild } from "@/server/build-reconcile.server";

/** Retry sooner than the browser watchdog would, but late enough that a
 *  healthy-but-quiet builder is never disturbed. */
const QUIET_MS = 150_000; // 2.5 minutes of silence
const MAX_PER_TICK = 5;

export async function handleBuildWatchdog(request: Request): Promise<Response> {
  const expected = process.env.BUILDER_SHARED_SECRET;
  const provided = request.headers.get("x-petal-cron-secret");
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Same tick also retries partner notifications whose receiver was down.
  const webhooks = await import("@/server/service-api.server")
    .then((m) => m.drainWebhookOutbox())
    .catch((e) => {
      console.error("[cron/build-watchdog] webhook outbox", e instanceof Error ? e.message : String(e));
      return null;
    });

  const stalled = await listStalledBuilds(QUIET_MS, MAX_PER_TICK);
  if (stalled.length === 0) {
    return Response.json({ ok: true, checked: 0, retried: 0, webhooks });
  }

  // Ask the build service what it is actually doing before assuming the worst:
  // a build it still owns is alive, and one it finished without telling us can
  // often be resolved from the live deployment instead of being re-run.
  const active = await fetchBuilderActive();

  const outcomes: string[] = [];
  for (const build of stalled) {
    try {
      const reconciled = await reconcileStalledBuild(build, active);
      if (reconciled.outcome === "still_running" || reconciled.outcome === "recovered") {
        outcomes.push(reconciled.outcome);
        continue;
      }
      const result = await retryStalledBuild(build.id, {
        minStuckMs: QUIET_MS,
        source: "cron/build-watchdog",
      });
      outcomes.push(result.outcome);
    } catch (e) {
      console.error(
        "[cron/build-watchdog] retry threw",
        build.id,
        e instanceof Error ? e.message : String(e),
      );
      outcomes.push("error");
    }
  }

  console.info(`[cron/build-watchdog] ${outcomes.join(",")}`);
  return Response.json({
    ok: true,
    checked: stalled.length,
    retried: outcomes.filter((o) => o === "retried").length,
    failed: outcomes.filter((o) => o === "failed").length,
    webhooks,
  });
}

export const Route = createFileRoute("/api/public/cron/build-watchdog")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBuildWatchdog(request),
    },
  },
});
