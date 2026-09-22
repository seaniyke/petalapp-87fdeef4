/**
 * Watchdog for stuck builds (browser-driven).
 *
 * The trigger route inserts a `pending` row and posts to the build service. If
 * the builder never calls our callback (cold start, transient network issue,
 * dropped webhook), the row sits at `pending` forever and the user sees a
 * spinner that never finishes.
 *
 * The client (`useBuildActivity`) calls this route after a build has been
 * pending for ~90s with no movement. The actual retry — claim, heal, re-post —
 * lives in `build-retry.server` and is shared with the server-side sweeper at
 * `/api/public/cron/build-watchdog`, so a stalled build is rescued whether or
 * not the tab is still open.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { retryStalledBuild } from "@/server/build-retry.server";
import { reconcileBuildById } from "@/server/build-reconcile.server";

const BodySchema = z.object({ buildId: z.string().uuid() });

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  return data.claims.sub;
}

export const Route = createFileRoute("/api/builds/watchdog")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const userId = userIdOrResp;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

        // Never re-run a build the service is still working on, and prefer
        // recovering a finished-but-unreported build over rebuilding it.
        const reconciled = await reconcileBuildById(parsed.data.buildId, {
          requireOwnerId: userId,
        });
        if (reconciled.outcome === "still_running") {
          return Response.json({ ok: true, action: "alive", label: reconciled.label ?? null });
        }
        if (reconciled.outcome === "recovered") {
          return Response.json({ ok: true, action: "recovered", url: reconciled.url });
        }

        const result = await retryStalledBuild(parsed.data.buildId, {
          requireOwnerId: userId,
          source: "watchdog",
        });

        if (result.outcome === "not_found") {
          return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
        }
        if (result.outcome === "retried") {
          return Response.json({ ok: true, action: "retried", attempt: result.attempt });
        }
        if (result.outcome === "retry_failed") {
          return Response.json({ ok: false, action: "retry_failed", error: result.error });
        }
        if (result.outcome === "failed" || result.outcome === "no_files") {
          return Response.json({ ok: true, action: "failed", reason: result.outcome });
        }
        return Response.json({ ok: true, action: "noop", reason: result.outcome });
      },
    },
  },
});
