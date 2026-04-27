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
import { applyScaffoldKit, STYLES_CSS } from "@/server/scaffold-kit";
import { syncViteAliasesWithTsconfig } from "@/server/sync-vite-aliases.server";
import { validateStylesCss } from "@/server/validate-styles.server";
import {
  buildIntegrationEnvFiles,
  mergeFilesIntoPayload,
} from "@/server/integrations/env-injector.server";

const BodySchema = z.object({ projectId: z.string().uuid() });

async function authorize(request: Request): Promise<string | Response> {
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
          .select("id, owner_id")
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
          .select("path, content")
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
        const scaffolded = applyScaffoldKit(files, { backend });
        // 2c) Defense-in-depth: keep tsconfig "paths" and Vite aliases in sync.
        //     If `vite.config.ts` is ever missing an alias for a tsconfig
        //     `paths` entry (older project, manual edit, AI emitted a slimmer
        //     config), Rollup would fail to resolve `@/...` imports at build
        //     time. This step injects any missing aliases. No-op when they're
        //     already aligned (the canonical scaffold already declares them).
        const aliasFixed = syncViteAliasesWithTsconfig(scaffolded);

        // 2d) Validate `src/styles.css` and fall back to the canonical scaffold
        //     CSS if it's broken. Tailwind v4 aborts the entire build on any
        //     invalid declaration (a stray `1`, an unbalanced brace, a missing
        //     `@import "tailwindcss";`). We never want one bad character in a
        //     stylesheet to take the whole deploy down — the user can keep
        //     iterating on the rest of the app, and Petal can fix the CSS on
        //     the next turn.
        const buildFiles = aliasFixed.map((f) => {
          if (f.path !== "src/styles.css") return f;
          const result = validateStylesCss(f.content);
          if (result.ok) return f;
          console.warn(
            `[styles.css invalid] project=${projectId} reason="${result.reason}" — falling back to scaffold default`
          );
          return { ...f, content: STYLES_CSS };
        });

        // 2e) Inject env files for installed integrations. This loads each
        //     integration's public options + decrypted secrets and renders
        //     `.env.production` (Vite-consumed at build time) and `.dev.vars`
        //     (Cloudflare convention for Pages/Workers runtime + local dev).
        //     Without this step, scaffolded code that reads
        //     `import.meta.env.VITE_*` or `process.env.*` would build with
        //     undefined values and silently no-op at runtime. Failures here
        //     are non-fatal — we log and continue with no env file rather
        //     than blocking the deploy.
        let withEnv = buildFiles;
        try {
          const envBundle = await buildIntegrationEnvFiles(projectId, buildFiles);
          if (envBundle.files.length > 0) {
            withEnv = mergeFilesIntoPayload(buildFiles, envBundle.files);
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

        await supabaseAdmin
          .from("projects")
          .update({ latest_build_id: build.id })
          .eq("id", projectId);

        // 4) Fire the build. If the network call fails, mark the row as failed.
        try {
          await postBuildToRailway({ projectId, buildId: build.id, files: withEnv });
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
          return Response.json(
            { buildId: build.id, status: "failed" as const, error: message },
            { status: 502 }
          );
        }

        return Response.json({ buildId: build.id, status: "pending" as const });
      },
    },
  },
});
