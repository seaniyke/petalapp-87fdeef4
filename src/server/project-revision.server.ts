import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Read the project's files together with the code revision they belong to.
 * The revision is read before and after the files; if a save landed in
 * between, read again, so a build is never labelled with a revision whose
 * files it did not pack.
 */
export async function readFilesAtRevision(projectId: string): Promise<
  | { ok: true; revision: number; files: Array<{ path: string; content: string; updated_at?: string }> }
  | { ok: false; error: string }
> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await supabaseAdmin.from("projects").select("revision").eq("id", projectId).maybeSingle();
    if (before.error || !before.data) return { ok: false, error: before.error?.message ?? "Project not found" };
    const files = await supabaseAdmin
      .from("project_files")
      .select("path, content, updated_at")
      .eq("project_id", projectId);
    if (files.error) return { ok: false, error: files.error.message };
    const after = await supabaseAdmin.from("projects").select("revision").eq("id", projectId).maybeSingle();
    if (after.error || !after.data) return { ok: false, error: after.error?.message ?? "Project not found" };
    if (Number(before.data.revision) === Number(after.data.revision)) {
      return { ok: true, revision: Number(after.data.revision), files: files.data ?? [] };
    }
  }
  return { ok: false, error: "The project kept changing while its files were read. Try again." };
}
