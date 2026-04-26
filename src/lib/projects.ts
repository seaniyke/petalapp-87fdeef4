import { supabase } from "@/integrations/supabase/client";
import type { ProjectFile, ChatMessage } from "@/server/generate.server";
import type { Database } from "@/integrations/supabase/types";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export async function listProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createProject(
  title = "Untitled project",
  opts: { remixed_from_id?: string } = {}
): Promise<ProjectRow> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: userData.user.id,
      title,
      slug: "",
      remixed_from_id: opts.remixed_from_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Public list for /gallery — featured first, then by remix_count, then recency. */
export async function listPublicProjects(limit = 60): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("is_public", true)
    .order("is_featured", { ascending: false })
    .order("remix_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Admin-only: flip is_featured. RLS + trigger guard enforce server-side. */
export async function setProjectFeatured(id: string, is_featured: boolean): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .update({ is_featured })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Clone a public project's files into a brand-new project owned by the current user. */
export async function remixProjectBySlug(slug: string): Promise<ProjectRow> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not signed in");
  const source = await getProjectBySlug(slug);
  if (!source) throw new Error("Project not found");
  if (!source.is_public) throw new Error("This project is not public");

  const files = await loadProjectFiles(source.id);
  const newTitle = `${source.title} (remix)`;
  const fresh = await createProject(newTitle, { remixed_from_id: source.id });
  if (files.length > 0) {
    const { error } = await supabase
      .from("project_files")
      .insert(
        files.map((f) => ({ project_id: fresh.id, path: f.path, content: f.content }))
      );
    if (error) throw error;
  }
  if (source.summary) {
    await updateProject(fresh.id, { summary: source.summary });
  }
  return fresh;
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, "title" | "summary" | "is_public">>
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ path: r.path, content: r.content }));
}

export async function loadProjectMessages(projectId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    role: r.role as ChatMessage["role"],
    content: r.content,
  }));
}

/**
 * Replace all files for a project with the given set (matches the AI's full-project rewrite).
 */
export async function saveProjectFiles(projectId: string, files: ProjectFile[]) {
  // Wipe existing rows then bulk-insert. Two RTTs but simple and correct.
  const del = await supabase.from("project_files").delete().eq("project_id", projectId);
  if (del.error) throw del.error;
  if (files.length === 0) return;
  const { error } = await supabase
    .from("project_files")
    .insert(files.map((f) => ({ project_id: projectId, path: f.path, content: f.content })));
  if (error) throw error;
}

export async function appendMessages(projectId: string, msgs: ChatMessage[]) {
  if (msgs.length === 0) return;
  const { error } = await supabase
    .from("messages")
    .insert(msgs.map((m) => ({ project_id: projectId, role: m.role, content: m.content })));
  if (error) throw error;
}

/** Update the project title from a generated summary if still default. */
export async function maybeAutoTitleProject(project: ProjectRow, summary: string, firstUserPrompt: string) {
  if (project.title !== "Untitled project") return;
  // Use the user's first prompt as the title (trimmed)
  const candidate = firstUserPrompt.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!candidate) return;
  await updateProject(project.id, { title: candidate, summary });
}
