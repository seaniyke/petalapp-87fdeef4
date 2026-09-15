/**
 * Growth watcher.
 *
 * Runs daily over every app still on the shared database and upgrades the
 * ones that have outgrown it onto their own database. Bounded per run so a
 * sweep can never exhaust Petal's dedicated-database capacity in one go.
 *
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runGrowthWatcher } from "@/server/backend-autoscale.server";
import { secretsMatch } from "@/server/rate-limit.server";

/** Never upgrade more than this many apps in a single sweep. */
const MAX_UPGRADES_PER_RUN = 10;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function run(provided: string | null): Promise<Response> {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return new Response("Server misconfigured", { status: 500 });
  if (!secretsMatch(provided, secret)) return unauthorized();
  try {
    const result = await runGrowthWatcher(MAX_UPGRADES_PER_RUN);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[autoscale-cron] failed", msg);
    return new Response(msg, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/backend-autoscale")({
  server: {
    handlers: {
      POST: ({ request }) => run(request.headers.get("x-petal-cron-secret")),
      GET: ({ request }) =>
        run(
          request.headers.get("x-petal-cron-secret") ??
            new URL(request.url).searchParams.get("secret"),
        ),
    },
  },
});
