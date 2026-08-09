/**
 * W5 — nightly benchmark cron.
 *
 * Schedule: 02:00 UTC daily via pg_cron.
 * Auth: `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 *
 * The run is long (15 real builds, sequential), so the handler kicks it off
 * and returns immediately — results land in `benchmark_runs` /
 * `benchmark_cases` and are read from /admin/benchmark.
 *
 * `?only=case-a,case-b` runs a subset, for manual smoke checks.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runNightlyBenchmark } from "@/server/benchmark.server";
import { secretsMatch } from "@/server/rate-limit.server";

function start(request: Request, trigger: "cron" | "manual") {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return new Response("Server misconfigured", { status: 500 });
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-petal-cron-secret") ?? url.searchParams.get("secret");
  if (!secretsMatch(provided, secret)) return new Response("Unauthorized", { status: 401 });

  const only = (url.searchParams.get("only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Fire and forget: a 15-case suite outlives any sane request timeout.
  void runNightlyBenchmark({ trigger, only }).catch((e) => {
    console.error("[benchmark cron] run failed", e instanceof Error ? e.message : String(e));
  });

  return Response.json({ ok: true, started: true, cases: only.length || 15 });
}

export const Route = createFileRoute("/api/public/cron/benchmark")({
  server: {
    handlers: {
      POST: async ({ request }) => start(request, "cron"),
      GET: async ({ request }) => start(request, "manual"),
    },
  },
});
