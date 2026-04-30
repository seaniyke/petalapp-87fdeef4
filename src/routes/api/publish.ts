/**
 * /api/publish — pin the latest successful build as the project's "published"
 * build, and/or update visibility (`public` | `private` | `unpublished`).
 *
 * Why this exists when builds already deploy on every prompt:
 *   At the infrastructure layer, every build overwrites the same Cloudflare
 *   Pages project (see `host-routing.server.ts`), so visitors do see the
 *   latest preview build the moment it's ready. This route gives us a
 *   *logical* publish boundary on top of that:
 *
 *     - `projects.published_build_id` records which build the owner has
 *       explicitly endorsed as the live one (used to drive "Update available"
 *       in the Publish sheet).
 *     - `projects.published_visibility` gates whether the custom domain serves
 *       the app at all (`unpublished` → 404, `private` → 403 for now,
 *       `public` → proxy as normal).
 *     - `projects.published_at` timestamps the action.
 *
 *  Future work: deploy each build to a unique Pages project so we can serve
 *  the pinned build independently of the latest preview build. Until then,
 *  publishing is a soft pin — useful for the UX, not a hard freeze.
 *
 * Auth: bearer token in the `Authorization` header (same pattern as
 * `/api/builds/trigger`). Owner of the project only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { freshenStaleYears } from "@/server/freshen-stale-years.server";
import { postBuildToRailway } from "@/server/builder.server";
import type { ProjectFile } from "@/server/generate.server";

/**
 * Best-effort: rewrite stale copyright years (e.g. "© 2024" → current year)
 * across the project's stored files at publish time. If anything changed,
 * persist the rewrites and ship a fresh build so visitors see current years.
 *
 * Why here: previously-shipped builds were generated before our defenses
 * landed, so re-publishing alone wouldn't fix them. This catches them on the
 * deliberate publish action without forcing the user to re-prompt.
 *
 * Silent on failure — publish never fails because of this pass.
 */
async function freshenAndReshipIfStale(
  projectId: string,
  hidePetalBadge: boolean,
): Promise<void> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("project_files")
      .select("path, content")
      .eq("project_id", projectId);
    if (error || !rows?.length) return;

    const files: ProjectFile[] = rows.map((r) => ({ path: r.path, content: r.content }));
    const { files: freshened, replacements } = freshenStaleYears(files);
    if (replacements === 0) return;

    // Persist only the files that actually changed.
    const changed = freshened.filter((f, i) => f.content !== files[i].content);
    for (const f of changed) {
      await supabaseAdmin
        .from("project_files")
        .update({ content: f.content })
        .eq("project_id", projectId)
        .eq("path", f.path);
    }

    // Create a new build row + ship — re-uses the standard build pipeline so
    // the deployed Cloudflare Pages project gets the fresh files.
    const { data: build } = await supabaseAdmin
      .from("project_builds")
      .insert({ project_id: projectId, status: "pending" })
      .select("id")
      .single();
    if (!build) return;
    await supabaseAdmin
      .from("projects")
      .update({ latest_build_id: build.id })
      .eq("id", projectId);

    await postBuildToRailway({
      projectId,
      buildId: build.id,
      files: freshened,
      hideBadge: hidePetalBadge,
    });
    console.log(
      `[publish] freshened ${replacements} stale year ref(s) for project=${projectId} (build=${build.id})`,
    );
  } catch (e) {
    console.warn(
      `[publish] year-freshen pass failed for project=${projectId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

const VisibilitySchema = z.enum(["public", "private", "unpublished"]);

const BodySchema = z.object({
  projectId: z.string().uuid(),
  /** Optional: change visibility as part of this publish. */
  visibility: VisibilitySchema.optional(),
  /**
   * If true, pin the project's current `latest_build_id` as the published
   * build. If the latest build isn't `ready` we return 409 — visitors would
   * otherwise be pinned to a half-broken deployment.
   */
  pinLatestBuild: z.boolean().optional().default(true),
});

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
  const supabase = createClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

export const Route = createFileRoute("/api/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const userId = userIdOrResp;

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid body" },
            { status: 400 },
          );
        }
        const { projectId, visibility, pinLatestBuild } = parsed.data;

        // Ownership check.
        const { data: project, error: projErr } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id, latest_build_id, published_build_id, published_visibility, hide_petal_badge")
          .eq("id", projectId)
          .maybeSingle();
        if (projErr) {
          return Response.json(
            { error: `Could not load project: ${projErr.message}` },
            { status: 500 },
          );
        }
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        if (project.owner_id !== userId) {
          return Response.json(
            { error: "Not authorized to publish this project" },
            { status: 403 },
          );
        }

        const updates: {
          published_build_id?: string | null;
          published_visibility?: string;
          published_at?: string;
        } = {};

        if (pinLatestBuild) {
          if (!project.latest_build_id) {
            return Response.json(
              { error: "There's no build to publish yet — generate the app first." },
              { status: 409 },
            );
          }
          const { data: build, error: buildErr } = await supabaseAdmin
            .from("project_builds")
            .select("id, status")
            .eq("id", project.latest_build_id)
            .maybeSingle();
          if (buildErr) {
            return Response.json(
              { error: `Could not load latest build: ${buildErr.message}` },
              { status: 500 },
            );
          }
          if (!build || build.status !== "ready") {
            return Response.json(
              {
                error:
                  "The latest build isn't ready yet — wait for it to finish (or retry if it failed) and try again.",
              },
              { status: 409 },
            );
          }
          updates.published_build_id = build.id;
          updates.published_at = new Date().toISOString();
          // First publish flips visibility to public unless caller explicitly
          // requested something else. Subsequent publishes preserve the
          // existing visibility.
          if (
            !visibility &&
            project.published_visibility === "unpublished"
          ) {
            updates.published_visibility = "public";
          }
        }

        if (visibility) {
          updates.published_visibility = visibility;
          // Unpublishing also clears the pinned build so a future re-publish
          // is a deliberate action.
          if (visibility === "unpublished") {
            updates.published_build_id = null;
          }
        }

        if (Object.keys(updates).length === 0) {
          return Response.json({ error: "Nothing to update" }, { status: 400 });
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
          .from("projects")
          .update(updates)
          .eq("id", projectId)
          .select(
            "id, published_build_id, published_visibility, published_at, latest_build_id",
          )
          .single();
        if (updateErr) {
          return Response.json(
            { error: `Failed to update publish state: ${updateErr.message}` },
            { status: 500 },
          );
        }

        return Response.json({ ok: true, project: updated });
      },
    },
  },
});
