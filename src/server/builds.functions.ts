/**
 * Server function the client calls right after a successful generation to
 * kick off a Cloudflare Pages build on the Railway builder service.
 *
 * Steps:
 *  1) Verify the caller owns the project (RLS would reject anyway, but we want
 *     a clean error before we hit Railway).
 *  2) Insert a `pending` row in `project_builds` and store its id on the
 *     project as `latest_build_id` so the UI can subscribe immediately.
 *  3) Load the project files via the admin client and POST them to Railway.
 *  4) Railway calls `/api/public/builds/callback` when it's done — that route
 *     flips the row to `ready` (with `dist_path`) or `failed`.
 *
 * If the POST to Railway fails, we mark the row as failed right away so the
 * UI doesn't sit on a "pending" build forever.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postBuildToRailway } from "@/server/builder.server";

export const triggerProjectBuild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { projectId } = data;

    // 1) Ownership check — read-only, fast, gives a clean error.
    const { data: project, error: projectErr } = await supabaseAdmin
      .from("projects")
      .select("id, owner_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projectErr) throw new Error(`Could not load project: ${projectErr.message}`);
    if (!project) throw new Error("Project not found");
    if (project.owner_id !== userId) {
      throw new Error("Not authorized to build this project");
    }

    // 2) Load files (admin client bypasses RLS — safe, we already authorized).
    const { data: rawFiles, error: filesErr } = await supabaseAdmin
      .from("project_files")
      .select("path, content")
      .eq("project_id", projectId);
    if (filesErr) throw new Error(`Could not load files: ${filesErr.message}`);
    const files = (rawFiles ?? []).map((r) => ({ path: r.path, content: r.content }));
    if (files.length === 0) {
      throw new Error("Project has no files to build");
    }

    // 3) Insert pending build row + bump latest_build_id BEFORE calling Railway,
    //    so a fast callback never races ahead of our own write.
    const { data: build, error: insertErr } = await supabaseAdmin
      .from("project_builds")
      .insert({ project_id: projectId, status: "pending" })
      .select("id")
      .single();
    if (insertErr || !build) {
      throw new Error(`Could not record build: ${insertErr?.message ?? "unknown"}`);
    }

    await supabaseAdmin
      .from("projects")
      .update({ latest_build_id: build.id })
      .eq("id", projectId);

    // 4) Fire the build. If the network call fails, mark the row as failed.
    try {
      await postBuildToRailway({ projectId, buildId: build.id, files });
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
      return { buildId: build.id, status: "failed" as const, error: message };
    }

    return { buildId: build.id, status: "pending" as const };
  });
