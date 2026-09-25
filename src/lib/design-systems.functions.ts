import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Apply a design-system package to a project deterministically (no AI).
 * Returns the new revision; the caller starts the build with the existing
 * `triggerBuild(projectId, { revision })` path so only this revision can
 * become ready.
 */
export const applyDesignSystemToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      projectId: z.string().uuid(),
      systemId: z.string().min(1).max(64),
      accent: z.string().min(1).max(64).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS: only the owner can see the project.
    const { data: owned } = await supabase.from("projects").select("id").eq("id", data.projectId).maybeSingle();
    if (!owned) throw new Error("Project not found");

    const { rethemeProject } = await import("@/server/design-systems/retheme");
    const { getDesignSystem } = await import("@/server/design-systems/registry");
    const { loadPic, savePic } = await import("@/server/pic/pic-store.server");

    const result = await rethemeProject(
      {
        getPackage: (slug) => {
          const pkg = getDesignSystem(slug);
          return pkg && !pkg.meta.internal ? pkg : null;
        },
        async loadFiles(projectId) {
          const { data: rows, error } = await supabase.from("project_files").select("path, content").eq("project_id", projectId);
          if (error) throw error;
          return (rows ?? []) as { path: string; content: string }[];
        },
        async snapshot(projectId, files, label) {
          const { error } = await supabase.from("project_versions").insert([
            { project_id: projectId, files: files as never, label, summary: label, origin: "auto" },
          ]);
          if (error) throw error;
        },
        async saveFiles(projectId, files) {
          const { data: rev, error } = await supabase.rpc("replace_project_files", { _project_id: projectId, _files: files } as never);
          if (error) throw error;
          return rev == null ? null : Number(rev);
        },
        async loadDesign(projectId) {
          return (await loadPic(projectId))?.pic.design ?? null;
        },
        async saveDesign(projectId, design) {
          const stored = await loadPic(projectId);
          if (!stored) return;
          await savePic(projectId, { ...stored.pic, design }, { summary: `Design system set: ${design.package?.systemId}/${design.package?.accent}` });
        },
      },
      data,
    );
    return result;
  });
