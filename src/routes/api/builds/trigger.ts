/**
 * Authenticated API route the client calls to kick off a Cloudflare Pages
 * build on the Railway builder service.
 *
 * Why a route (and not a `createServerFn`)?
 *   `createServerFn` calls go to `/_serverFn/*` and the framework does NOT
 *   automatically forward the user's Supabase access token, so the
 *   `requireSupabaseAuth` middleware rejects them with 401. We mirror the
 *   pattern in `src/routes/api/generate.ts`: read the bearer token from
 *   the `Authorization` header, validate it, and continue.
 *
 * Steps:
 *  1) Verify the bearer token and ownership of the project.
 *  2) Insert a `pending` row in `project_builds` and store its id on the
 *     project as `latest_build_id` so the UI can subscribe immediately.
 *  3) POST the project files to Railway.
 *  4) Railway calls `/api/public/builds/callback` when it's done — that route
 *     flips the row to `ready` (with `dist_path`) or `failed`.
 *
 * If the POST to Railway fails, we mark the row as failed right away so the
 * UI doesn't sit on a "pending" build forever.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postBuildToRailway } from "@/server/builder.server";
import { buildVerifyPlan } from "@/server/verify-plan.server";
import { applyScaffoldKit } from "@/server/scaffold-kit";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import { runScopedBuildCleanup } from "@/server/build-cleanup-scope.server";
import { currentTurnContext } from "@/server/turn-context.server";
import {
  buildIntegrationEnvFiles,
  mergeFilesIntoPayload,
} from "@/server/integrations/env-injector.server";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  changedPaths: z.array(z.string().min(1).max(500)).max(100).optional(),
  turnId: z.string().max(200).optional(),
  unitId: z.string().max(200).optional(),
});

async function authorize(request: Request): Promise<string | Response> {
  const internalSecret = request.headers.get("x-petal-internal-secret");
  const internalUser = request.headers.get("x-petal-internal-user");
  if (internalSecret && internalUser) {
    const expected = process.env.BUILDER_SHARED_SECRET;
    if (expected && internalSecret === expected) return internalUser;
    return new Response("Unauthorized", { status: 401 });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

export const Route = createFileRoute("/api/builds/trigger")({
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
        if (!parsed.success) {
          return Response.json({ error: "Invalid body" }, { status: 400 });
        }
        const { projectId } = parsed.data;

        // 1) Ownership check — read-only, fast, gives a clean error.
        const { data: project, error: projectErr } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id, hide_petal_badge, latest_build_id")
          .eq("id", projectId)
          .maybeSingle();
        if (projectErr) {
          return Response.json(
            { error: `Could not load project: ${projectErr.message}` },
            { status: 500 }
          );
        }
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        if (project.owner_id !== userId) {
          return Response.json({ error: "Not authorized to build this project" }, { status: 403 });
        }

        // 2) Load files (admin client bypasses RLS — safe, we already authorized).
        const { data: rawFiles, error: filesErr } = await supabaseAdmin
          .from("project_files")
          .select("path, content, updated_at")
          .eq("project_id", projectId);
        if (filesErr) {
          return Response.json(
            { error: `Could not load files: ${filesErr.message}` },
            { status: 500 }
          );
        }
        const files = (rawFiles ?? []).map((r) => ({ path: r.path, content: r.content }));
        if (files.length === 0) {
          return Response.json({ error: "Project has no files to build" }, { status: 400 });
        }

        // Idempotency boundary: one saved file revision gets one deployment.
        // Multiple tabs, a reconnecting client, or duplicate result handlers
        // can all call this endpoint for the same files. Reuse the latest
        // active/successful build when it was created after the newest file
        // write instead of creating another Railway job.
        const newestFileWrite = Math.max(
          0,
          ...(rawFiles ?? []).map((row) => new Date(row.updated_at).getTime()),
        );
        if (project.latest_build_id) {
          const { data: latest } = await supabaseAdmin
            .from("project_builds")
            .select("id, status, created_at")
            .eq("id", project.latest_build_id)
            .maybeSingle();
          const latestCreatedAt = latest ? new Date(latest.created_at).getTime() : 0;
          const inFlight = latest?.status === "pending" || latest?.status === "building";
          // Concurrency guard: a job that started seconds ago is still writing
          // the same turn's files. Starting a second Railway job for the same
          // project makes both compete for the one container and they time out
          // mid-verification. Reuse the running job; the next trigger (after it
          // settles) picks up any newer edits.
          const justStarted = inFlight && Date.now() - latestCreatedAt < 120_000;
          if (
            latest &&
            (inFlight || latest.status === "ready") &&
            (justStarted || latestCreatedAt >= newestFileWrite)
          ) {
            return Response.json({
              buildId: latest.id,
              status: latest.status === "ready" ? "ready" as const : "pending" as const,
              reused: true,
            });
          }
        }

        // 2b) Re-apply the canonical scaffold kit so the build is self-healing.
        //     Without this, any project whose `project_files` rows are missing
        //     `src/components/ui/*`, `src/lib/utils.ts`, or the `@/*` paths
        //     alias in `tsconfig.json` (e.g. older projects, or rows that were
        //     never persisted) will fail with "Rollup failed to resolve import
        //     '@/components/ui/...'". `applyScaffoldKit` is a no-op for healthy
        //     projects (overwrite paths get re-set to the same content).
        const { data: backendRow } = await supabaseAdmin
          .from("project_backends")
          .select("supabase_url, anon_key")
          .eq("project_id", projectId)
          .maybeSingle();
        const backend = backendRow
          ? { url: backendRow.supabase_url, anonKey: backendRow.anon_key }
          : undefined;
        // Any throw in these deterministic prep steps used to escape as an
        // opaque framework 500 ("unhandled HTTPError") with no stack. Name the
        // step that failed and log it so the real cause is visible.
        let prepStage = "scaffold";
        let withEnv: typeof files;
        try {
          const scaffolded = applyScaffoldKit(files, { backend });
          // Publish-time self-heal for legacy projects. Generation already runs
          // this composition pass, but older saved files can predate a repair.
          // In particular, a stripped TanStack import with a surviving
          // `createFileRoute(...)` call builds successfully and then crashes in
          // the browser. Running the same deterministic repairs here guarantees
          // the deploy payload is safe even before the user makes another edit.
        prepStage = "repairs";
          const requestedCleanupPaths = parsed.data.changedPaths ?? [];
          const ambient = currentTurnContext();
          const cleaned = runScopedBuildCleanup(scaffolded, requestedCleanupPaths, {
            turnId: parsed.data.turnId ?? ambient.turnId ?? null,
            attemptId: ambient.attemptId ?? null,
            unitId: parsed.data.unitId ?? "build-trigger",
          });
          const repaired = { files: cleaned.files, notes: cleaned.notes };
          if (repaired.notes.length > 0) {
            console.info(
              `[build-repair] project=${projectId}: ${repaired.notes.join("; ")}`,
            );
          }
          // Shipping performs no second broad source-repair pipeline. The
          // generation turn's closed cleanup scope owns source healing.
          // 2f) Inject env files for installed integrations. This loads each
          //     integration's public options + decrypted secrets and renders
          //     `.env.production` (Vite-consumed at build time) and `.dev.vars`
          //     (Cloudflare convention for Pages/Workers runtime + local dev).
          //     Without this step, scaffolded code that reads
          //     `import.meta.env.VITE_*` or `process.env.*` would build with
          //     undefined values and silently no-op at runtime. Failures here
          //     are non-fatal — we log and continue with no env file rather
          //     than blocking the deploy.
        prepStage = "preview-guard";
          withEnv = injectPreviewGuard(repaired.files, { projectId }).files;
        } catch (e) {
          console.error(
            `[build-prep] project=${projectId} failed at stage=${prepStage}:`,
            e instanceof Error ? (e.stack ?? e.message) : String(e),
          );
          return Response.json(
            { error: `Build preparation failed at ${prepStage}`, stage: prepStage },
            { status: 500 },
          );
        }
        try {
          const envBundle = await buildIntegrationEnvFiles(projectId, withEnv);
          if (envBundle.files.length > 0) {
            withEnv = mergeFilesIntoPayload(withEnv, envBundle.files);
            console.log(
              `[integrations] project=${projectId} injected env from ${envBundle.integrationCount} integration(s): ${envBundle.envKeys.join(", ")}`
            );
          }
        } catch (e) {
          console.error(
            `[integrations] env injection failed for project=${projectId}:`,
            e instanceof Error ? e.message : String(e)
          );
        }

        // 2f) Decide whether to ship the "Powered by Kimble" badge. Free-plan
        //     projects always get it; paid-plan owners may opt out via
        //     project settings. Actual injection happens inside
        //     postBuildToRailway so EVERY build pathway shows the badge by
        //     default — even pathways that bypass this route.
        let hideBadge = false;
        try {
          const { data: wallet } = await supabaseAdmin
            .from("user_wallets")
            .select("plan_code, topup_credits_remaining")
            .eq("user_id", userId)
            .maybeSingle();
          const isPaidPlan =
            (!!wallet?.plan_code && wallet.plan_code !== "free") ||
            Number(wallet?.topup_credits_remaining ?? 0) > 0;
          hideBadge = isPaidPlan && project.hide_petal_badge === true;
        } catch (e) {
          console.warn(
            `[badge] could not determine plan for project=${projectId}:`,
            e instanceof Error ? e.message : String(e),
          );
          // On error, default to showing the badge (safer for the free tier).
          hideBadge = false;
        }

        // 3) Insert pending build row + bump latest_build_id BEFORE calling
        //    Railway, so a fast callback never races ahead of our own write.
        const { data: build, error: insertErr } = await supabaseAdmin
          .from("project_builds")
          .insert({ project_id: projectId, status: "pending" })
          .select("id")
          .single();
        if (insertErr || !build) {
          return Response.json(
            { error: `Could not record build: ${insertErr?.message ?? "unknown"}` },
            { status: 500 }
          );
        }

        // Compare-and-swap latest_build_id. If two identical requests raced,
        // only the one that still sees the project state we authorized above
        // may claim the project. The loser removes its orphan row and reuses
        // the winner, so even simultaneous duplicate calls create one job.
        let claimQuery = supabaseAdmin
          .from("projects")
          .update({ latest_build_id: build.id })
          .eq("id", projectId);
        claimQuery = project.latest_build_id
          ? claimQuery.eq("latest_build_id", project.latest_build_id)
          : claimQuery.is("latest_build_id", null);
        const { data: claimedProject } = await claimQuery
          .select("latest_build_id")
          .maybeSingle();

        if (!claimedProject) {
          await supabaseAdmin.from("project_builds").delete().eq("id", build.id);
          const { data: winner } = await supabaseAdmin
            .from("projects")
            .select("latest_build_id")
            .eq("id", projectId)
            .single();
          if (winner?.latest_build_id) {
            return Response.json({
              buildId: winner.latest_build_id,
              status: "pending" as const,
              reused: true,
            });
          }
          return Response.json(
            { error: "Could not claim this build. Please try again." },
            { status: 409 },
          );
        }

        // 4) Fire the build. If the network call fails, mark the row as failed.
        try {
          // Blocking post-deploy browser verification: the build isn't "ready"
          // until a real browser has loaded it, signed a throwaway user in, and
          // run the app's core write flows.
          // The persisted product contract drives what the browser checks:
          // the verifier proves the PRD's primary workflow, not just that the
          // page rendered.
          const storedPrd = await import("@/server/prd/prd-store.server")
            .then((m) => m.loadProjectPrd(projectId))
            .catch(() => null);
          // Change-aware QA: scope the browser pass to what this turn touched.
          // A missing or unreadable history row means "verify everything".
          let changedPaths: string[] | null = null;
          let forceFull = true;
          let editScope: "micro" | "targeted" | "structural" | null = null;
          try {
            const [{ data: lastEdit }, { count: priorBuilds }] = await Promise.all([
              supabaseAdmin
                .from("project_edit_history")
                .select("changed_paths, user_request")
                .eq("project_id", projectId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabaseAdmin
                .from("project_builds")
                .select("id", { count: "exact", head: true })
                .eq("project_id", projectId)
                .eq("status", "ready"),
            ]);
            const raw = lastEdit?.changed_paths;
            if (Array.isArray(raw)) {
              changedPaths = raw.filter((p): p is string => typeof p === "string");
            }
            // How big the ask itself read. Deterministic prior only — the same
            // function the generation turn used, so the finishing pass is sized
            // to the request without another model call.
            if (typeof lastEdit?.user_request === "string" && lastEdit.user_request.trim()) {
              const { classifyEditDeterministic } = await import(
                "@/server/edit-classifier.server"
              );
              editScope = classifyEditDeterministic(lastEdit.user_request).scope;
            }
            forceFull = !priorBuilds || priorBuilds === 0;
          } catch {
            /* fall back to a full sweep */
          }
          const verify = await buildVerifyPlan({
            files: withEnv,
            projectId,
            userId: userId ?? null,
            prd: storedPrd?.prd ?? null,
            changedPaths,
            forceFull,
            editScope,
          }).catch(() => undefined);
           await postBuildToRailway({
             projectId,
             buildId: build.id,
             files: withEnv,
             hideBadge,
             verify,
             cleanupPaths: parsed.data.changedPaths ?? [],
             cleanupMeta: {
               turnId: parsed.data.turnId ?? null,
               unitId: parsed.data.unitId ?? "builder-last-mile",
             },
           });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Failed to reach builder";
          console.error("postBuildToRailway failed", message);
          await supabaseAdmin
            .from("project_builds")
            .update({
              status: "failed",
              error_message: `Could not reach build service: ${message}`,
              ready_at: new Date().toISOString(),
            })
            .eq("id", build.id);
          return Response.json({
            buildId: build.id,
            status: "failed" as const,
            error: message,
            fallback: true,
          });
        }

        return Response.json({ buildId: build.id, status: "pending" as const });
      },
    },
  },
});

// "Powered by Kimble" badge injection now lives in
// src/server/petal-badge.server.ts and is applied inside postBuildToRailway,
// so every build pathway gets it by default. This route only decides whether
// to opt out (paid plans that toggled the badge off in project settings).
