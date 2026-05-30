/**
 * Watchdog for stuck builds.
 *
 * The trigger route inserts a `pending` row and posts to Railway. If
 * Railway never calls our callback (cold start, transient network
 * issue, dropped webhook), the row sits at `pending` forever and the
 * user sees a spinner that never finishes.
 *
 * The client (`useBuildActivity`) calls this route after a build has
 * been pending for ~90s with no movement. We:
 *  1) Verify the build is still pending and the user owns the project.
 *  2) If `retry_count < 2`, re-post the existing files to Railway and
 *     bump the retry counter. The same buildId is reused so the UI
 *     subscription keeps pointing at the right row.
 *  3) If retries are exhausted, mark the row as `failed` with a clear
 *     "service didn't respond" message so the user can act.
 *
 * The retry path reuses the canonical scaffold + healing pipeline from
 * the trigger route so a transient bug in earlier-emitted files can
 * heal itself on the second attempt.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postBuildToRailway } from "@/server/builder.server";
import { applyScaffoldKit, STYLES_CSS } from "@/server/scaffold-kit";
import { syncViteAliasesWithTsconfig } from "@/server/sync-vite-aliases.server";
import { validateStylesCss } from "@/server/validate-styles.server";
import { autofixFiles } from "@/server/stream-autofixer";
import { shimMissingUiPrimitives } from "@/server/shim-missing-ui.server";
import { stripTypeOnlyValueImports } from "@/server/strip-type-only-value-imports.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import {
  buildIntegrationEnvFiles,
  mergeFilesIntoPayload,
} from "@/server/integrations/env-injector.server";

const MAX_RETRIES = 2;
const MIN_STUCK_MS = 80_000; // small grace below the 90s client trigger

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
        const { buildId } = parsed.data;

        const { data: build } = await supabaseAdmin
          .from("project_builds")
          .select("id, project_id, status, retry_count, created_at")
          .eq("id", buildId)
          .maybeSingle();
        if (!build) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
        if (build.status !== "pending") {
          return Response.json({ ok: true, action: "noop", reason: "not_pending" });
        }

        const ageMs = Date.now() - new Date(build.created_at).getTime();
        if (ageMs < MIN_STUCK_MS) {
          return Response.json({ ok: true, action: "noop", reason: "not_stuck_yet" });
        }

        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id, hide_petal_badge")
          .eq("id", build.project_id)
          .maybeSingle();
        if (!project || project.owner_id !== userId) {
          return Response.json({ error: "Not authorized" }, { status: 403 });
        }

        // Retry budget exhausted — give up cleanly.
        if ((build.retry_count ?? 0) >= MAX_RETRIES) {
          await supabaseAdmin
            .from("project_builds")
            .update({
              status: "failed",
              error_message:
                "The build service didn't respond after multiple attempts. Please try again in a moment.",
              ready_at: new Date().toISOString(),
            })
            .eq("id", buildId);
          return Response.json({ ok: true, action: "failed", reason: "retries_exhausted" });
        }

        // Bump counter atomically by reading current value first (no UPDATE
        // RETURNING here keeps the path simple).
        const nextRetry = (build.retry_count ?? 0) + 1;
        await supabaseAdmin
          .from("project_builds")
          .update({ retry_count: nextRetry, last_retry_at: new Date().toISOString() })
          .eq("id", buildId);

        // Re-load files + reapply the healing pipeline. A second pass through
        // the autofix/shim/type-strip steps frequently rescues a build whose
        // first attempt was flaky (Railway cold start, malformed file healed
        // by a later edit, etc.).
        const { data: rawFiles } = await supabaseAdmin
          .from("project_files")
          .select("path, content")
          .eq("project_id", build.project_id);
        const files = (rawFiles ?? []).map((r) => ({ path: r.path, content: r.content }));
        if (files.length === 0) {
          await supabaseAdmin
            .from("project_builds")
            .update({
              status: "failed",
              error_message: "Project has no files to build.",
              ready_at: new Date().toISOString(),
            })
            .eq("id", buildId);
          return Response.json({ ok: false, reason: "no_files" });
        }

        const { data: backendRow } = await supabaseAdmin
          .from("project_backends")
          .select("supabase_url, anon_key")
          .eq("project_id", build.project_id)
          .maybeSingle();
        const backend = backendRow
          ? { url: backendRow.supabase_url, anonKey: backendRow.anon_key }
          : undefined;
        const scaffolded = applyScaffoldKit(files, { backend });
        const aliasFixed = syncViteAliasesWithTsconfig(scaffolded);
        const styleSafeFiles = aliasFixed.map((f) => {
          if (f.path !== "src/styles.css") return f;
          const result = validateStylesCss(f.content);
          return result.ok ? f : { ...f, content: STYLES_CSS };
        });
        const { files: buildFiles } = autofixFiles(styleSafeFiles);
        const { files: shimmedFiles } = shimMissingUiPrimitives(buildFiles);
        const { files: typeStrippedFiles } = stripTypeOnlyValueImports(shimmedFiles);
        let withEnv = injectPreviewGuard(typeStrippedFiles, { projectId: build.project_id }).files;
        try {
          const envBundle = await buildIntegrationEnvFiles(build.project_id, withEnv);
          if (envBundle.files.length > 0) {
            withEnv = mergeFilesIntoPayload(withEnv, envBundle.files);
          }
        } catch (e) {
          console.warn(
            `[watchdog] env injection failed for project=${build.project_id}:`,
            e instanceof Error ? e.message : String(e),
          );
        }

        let hideBadge = false;
        try {
          const { data: wallet } = await supabaseAdmin
            .from("user_wallets")
            .select("plan_code")
            .eq("user_id", userId)
            .maybeSingle();
          const isPaidPlan = !!wallet?.plan_code && wallet.plan_code !== "free";
          hideBadge = isPaidPlan && project.hide_petal_badge === true;
        } catch {
          hideBadge = false;
        }

        try {
          await postBuildToRailway({
            projectId: build.project_id,
            buildId,
            files: withEnv,
            hideBadge,
          });
          console.log(`[watchdog] retried build=${buildId} attempt=${nextRetry}`);
          return Response.json({ ok: true, action: "retried", attempt: nextRetry });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Failed to reach builder";
          if (nextRetry >= MAX_RETRIES) {
            await supabaseAdmin
              .from("project_builds")
              .update({
                status: "failed",
                error_message: `Could not reach build service after ${nextRetry} attempts: ${message}`,
                ready_at: new Date().toISOString(),
              })
              .eq("id", buildId);
          }
          return Response.json({ ok: false, action: "retry_failed", error: message });
        }
      },
    },
  },
});
