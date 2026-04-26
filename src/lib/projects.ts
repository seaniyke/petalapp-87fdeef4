import { supabase } from "@/integrations/supabase/client";
import type { ProjectFile, ChatMessage } from "@/server/generate.server";
import type { Database } from "@/integrations/supabase/types";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export type ProjectBackend = {
  status: "connecting" | "ready" | "failed" | "paused";
  provider: "byo_supabase" | "managed_supabase";
  supabaseUrl: string;
  anonKey: string;
  errorMessage: string | null;
} | null;

async function backendApi<T>(action: "status" | "connect" | "disconnect", body: unknown): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/backend?action=${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed (${resp.status})`);
  }
  return (await resp.json()) as T;
}

/** Look up the backend attached to a project, if any. */
export function getProjectBackend(projectId: string): Promise<ProjectBackend> {
  return backendApi<ProjectBackend>("status", { projectId });
}

/** Connect a BYO Supabase backend to a project. */
export function connectProjectBackend(input: {
  projectId: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
}): Promise<NonNullable<ProjectBackend>> {
  return backendApi<NonNullable<ProjectBackend>>("connect", input);
}

/** Disconnect the backend from a project. */
export function disconnectProjectBackend(projectId: string): Promise<{ ok: true }> {
  return backendApi<{ ok: true }>("disconnect", { projectId });
}

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
  patch: Partial<Pick<ProjectRow, "title" | "summary" | "is_public" | "custom_instructions" | "slug">>
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
 * Atomically replace all files for a project with the given set.
 * Uses a server-side function so the delete-of-removed and upsert-of-changed
 * happen in a single transaction — a failed save never empties the project.
 */
export async function saveProjectFiles(projectId: string, files: ProjectFile[]) {
  // Cast: the generated types treat jsonb args narrowly, but our payload is a
  // plain JSON array of {path, content} which the RPC handles natively.
  const { error } = await supabase.rpc(
    "replace_project_files",
    { _project_id: projectId, _files: files } as never
  );
  if (error) throw error;
}

export async function appendMessages(projectId: string, msgs: ChatMessage[]) {
  if (msgs.length === 0) return;
  const { error } = await supabase
    .from("messages")
    .insert(msgs.map((m) => ({ project_id: projectId, role: m.role, content: m.content })));
  if (error) throw error;
}

/**
 * Trim chat history to the first `keepCount` messages (chronological).
 * Used by per-message revert so the conversation reflects the restored state.
 */
export async function truncateMessagesToCount(projectId: string, keepCount: number) {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  const toDelete = ids.slice(keepCount);
  if (toDelete.length === 0) return;
  const { error: delErr } = await supabase
    .from("messages")
    .delete()
    .in("id", toDelete);
  if (delErr) throw delErr;
}

/** Truncate to ~200 chars on a word boundary. Used to keep summaries SEO-friendly. */
export function truncateSummary(s: string, max = 200): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
}

/** Build a URL-safe slug from arbitrary text, with a short id suffix for uniqueness. */
export function slugifyForProject(text: string, projectId: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
  const suffix = projectId.replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}

/** Update the project title from a generated summary if still default. */
export async function maybeAutoTitleProject(project: ProjectRow, summary: string, firstUserPrompt: string) {
  if (project.title !== "Untitled project") return;
  const candidate = firstUserPrompt.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!candidate) return;
  await updateProject(project.id, {
    title: candidate,
    summary: truncateSummary(summary),
    slug: slugifyForProject(candidate, project.id),
  });
}
