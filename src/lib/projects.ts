import { supabase } from "@/integrations/supabase/client";
import type { ProjectFile, ChatMessage } from "@/server/generate.server";
import type { Database } from "@/integrations/supabase/types";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export type ProjectBackend = {
  status: "connecting" | "ready" | "failed" | "paused" | "provisioning";
  provider: "byo_supabase" | "managed_petal" | "managed_supabase" | "shared_petal";
  supabaseUrl: string;
  anonKey: string;
  errorMessage: string | null;
  supabaseProjectRef?: string | null;
  pausedAt?: string | null;
  /** ISO timestamp of when provisioning started (managed only). */
  provisioningStartedAt?: string | null;
  /** ISO timestamp of the last usage signal (managed only). */
  lastActiveAt?: string | null;
  /**
   * For managed backends only: when set, the project's Cloud balance has run
   * out and the backend will be paused after this timestamp unless the user
   * tops up. Cleared automatically once the user adds Cloud balance.
   */
  graceUntil?: string | null;
  /**
   * The project's backend tier: `shared` (default, no dedicated project) or
   * `dedicated` (a provisioned Supabase project).
   */
  backendType?: "shared" | "dedicated";
} | null;

export type ManagedProvisionStatus = {
  status: "provisioning" | "ready" | "paused" | "failed" | "missing";
  errorMessage: string | null;
  supabaseUrl: string | null;
  supabaseProjectRef: string | null;
  upstreamStatus: string | null;
};

export type ManagedCredentials = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string | null;
  supabaseProjectRef: string | null;
};

type BackendAction =
  | "status"
  | "connect"
  | "disconnect"
  | "provision-status"
  | "provision-retry"
  | "managed-credentials"
  | "enable-managed"
  | "enable-shared"
  | "shared-status"
  | "disable-shared";


async function backendApi<T>(action: BackendAction, body: unknown): Promise<T> {
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
    // Server returns structured JSON for known failure codes (e.g. topup_required).
    try {
      const j = JSON.parse(text) as { error?: string; code?: string };
      const err = new Error(j.error || `Request failed (${resp.status})`) as Error & {
        code?: string;
        status?: number;
        body?: unknown;
      };
      if (j.code) err.code = j.code;
      err.status = resp.status;
      err.body = j;
      throw err;
    } catch (parseErr) {
      if (parseErr instanceof Error && (parseErr as { code?: string }).code) throw parseErr;
      throw new Error(text || `Request failed (${resp.status})`);
    }
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

/** Poll the provisioning status of a Petal-managed backend. */
export function getManagedProvisionStatus(projectId: string): Promise<ManagedProvisionStatus> {
  return backendApi<ManagedProvisionStatus>("provision-status", { projectId });
}

/** Retry provisioning after a failure (or after a pause/restore). */
export function retryManagedProvision(projectId: string): Promise<{ ok: true }> {
  return backendApi<{ ok: true }>("provision-retry", { projectId });
}

/** Download the credentials for a managed backend (for export / lock-in escape). */
export function getManagedCredentials(projectId: string): Promise<ManagedCredentials> {
  return backendApi<ManagedCredentials>("managed-credentials", { projectId });
}

/**
 * Enable a Petal-managed backend funded by the user's Cloud balance.
 *
 * Server-side guards:
 *   - Free plan → 402 with `code: "plan_upgrade_required"`. UI opens BillingSheet.
 *   - Paid plan + $0 balance → 402 with `code: "balance_empty"`. UI opens top-up.
 *   - Upstream Supabase create fails → 502 with `code: "provision_failed"`.
 *
 * On success the row is `provisioning` and the upstream `supabase_project_ref`
 * is already saved (awaited inline) — UI then polls `provision-status`.
 */
export async function enableManagedBackend(
  projectId: string,
): Promise<{ ok: true; status: "provisioning" }> {
  return backendApi<{ ok: true; status: "provisioning" }>("enable-managed", { projectId });
}

export type SharedBackendInfo = {
  enabled: boolean;
  projectId?: string;
  apiKey?: string;
  enabledAt?: string;
  usage?: { rows: number; users: number; collections: string[] };
  limits?: { maxRowsPerProject: number; maxCollections: number; maxPageSize: number };
};

/** Free tier: a shared backend that lives inside Petal Cloud (no dedicated project). */
export async function enableSharedBackend(projectId: string): Promise<SharedBackendInfo> {
  return backendApi<SharedBackendInfo>("enable-shared", { projectId });
}

export async function getSharedBackendStatus(projectId: string): Promise<SharedBackendInfo> {
  return backendApi<SharedBackendInfo>("shared-status", { projectId });
}

export async function disableSharedBackend(projectId: string): Promise<{ ok: true }> {
  return backendApi<{ ok: true }>("disable-shared", { projectId });
}

export async function listProjects(): Promise<ProjectRow[]> {
  // The "My projects" page must show ONLY the signed-in user's own projects.
  // Without this filter, the public-projects RLS policy ("is_public = true")
  // would also surface OTHER people's public projects in the list — and then
  // deleting one of those would be blocked by RLS, producing the confusing
  // "Could not delete this project" error users have been hitting.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", userData.user.id)
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

/** Public list for /gallery — featured first, then by remix_count, then recency.
 *  Excludes projects that have never been built (no published build) or that
 *  still carry the default "Untitled project" title — they look broken in the grid. */
export async function listPublicProjects(limit = 60): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("is_public", true)
    .not("published_build_id", "is", null)
    .not("title", "is", null)
    .neq("title", "")
    .neq("title", "Untitled project")
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
  // `.select()` makes Supabase return the deleted rows so we can verify the
  // delete actually landed. RLS-blocked deletes silently return success with
  // zero rows affected.
  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (data && data.length > 0) return; // happy path

  // 0 rows could mean: (a) the row was already gone (double-click, retry, or
  // a previous delete already landed) — that's SUCCESS, the desired end
  // state holds; or (b) RLS blocked it because the user doesn't own this
  // project. Disambiguate by reading the row back. If we can still see it,
  // RLS blocked the delete — surface a permission error. Otherwise treat as
  // already-deleted and return cleanly.
  const { data: still, error: readErr } = await supabase
    .from("projects")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!still) return; // already deleted — idempotent success

  const { data: userData } = await supabase.auth.getUser();
  const ownsIt = userData.user && still.owner_id === userData.user.id;
  if (ownsIt) {
    // We own it but the delete didn't land — almost always a stale auth
    // token (signed in elsewhere, refresh failed, etc.).
    throw new Error(
      "Couldn't delete this project — your session looks stale. Please sign out and back in, then try again.",
    );
  }
  throw new Error("You can only delete projects you own.");
}

export async function setProjectStarred(id: string, is_starred: boolean): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .update({ is_starred } as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, "title" | "summary" | "is_public" | "custom_instructions" | "slug" | "hide_petal_badge">>
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

function dedupeProjectFiles(files: ProjectFile[]): ProjectFile[] {
  const byPath = new Map<string, ProjectFile>();
  for (const file of files) {
    const path = file.path.trim();
    if (!path) continue;
    byPath.set(path, { path, content: file.content ?? "" });
  }
  return Array.from(byPath.values());
}

/** Marker prefix used to embed structured assistant fields (plan/recap) inside
 *  the existing `content` text column. Backward-compatible: any row without
 *  this prefix is treated as a plain text message. */
const STRUCTURED_PREFIX = "@@petal/v1:";

function encodeAssistantContent(m: ChatMessage): string {
  if (
    m.role !== "assistant" ||
    (!m.plan && !m.recap && !(m.suggestions && m.suggestions.length > 0) && !m.error)
  ) {
    return m.content;
  }
  return STRUCTURED_PREFIX + JSON.stringify({
    content: m.content,
    plan: m.plan ?? null,
    recap: m.recap ?? null,
    suggestions: m.suggestions ?? null,
    error: m.error ?? null,
  });
}

function decodeAssistantContent(role: string, raw: string): ChatMessage {
  if (role === "assistant" && raw.startsWith(STRUCTURED_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(STRUCTURED_PREFIX.length)) as {
        content?: string;
        plan?: string | null;
        recap?: string | null;
        suggestions?: string[] | null;
        error?: ChatMessage["error"] | null;
      };
      return {
        role: "assistant",
        content: parsed.content ?? "",
        plan: parsed.plan ?? undefined,
        recap: parsed.recap ?? undefined,
        suggestions:
          Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
            ? parsed.suggestions.filter((s): s is string => typeof s === "string")
            : undefined,
        error: parsed.error ?? undefined,
      };
    } catch {
      // Fall through to plain text on corrupt payload.
    }
  }
  return { role: role as ChatMessage["role"], content: raw };
}

export async function loadProjectMessages(projectId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => decodeAssistantContent(r.role, r.content));
}

/**
 * Atomically replace all files for a project with the given set.
 * Uses a server-side function so the delete-of-removed and upsert-of-changed
 * happen in a single transaction — a failed save never empties the project.
 */
export async function saveProjectFiles(projectId: string, files: ProjectFile[]) {
  const cleanFiles = dedupeProjectFiles(files);
  // Cast: the generated types treat jsonb args narrowly, but our payload is a
  // plain JSON array of {path, content} which the RPC handles natively.
  const { error } = await supabase.rpc(
    "replace_project_files",
    { _project_id: projectId, _files: cleanFiles } as never
  );
  if (error) throw error;
}

export async function appendMessages(projectId: string, msgs: ChatMessage[]) {
  if (msgs.length === 0) return;
  const { error } = await supabase
    .from("messages")
    .insert(
      msgs.map((m) => ({
        project_id: projectId,
        role: m.role,
        content: encodeAssistantContent(m),
      })),
    );
  if (error) throw error;
}

export async function deleteAssistantMessagesMatching(
  projectId: string,
  shouldDelete: (message: ChatMessage) => boolean,
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const ids = (data ?? [])
    .filter((row) => {
      const decoded = decodeAssistantContent(row.role, row.content);
      return decoded.role === "assistant" && shouldDelete(decoded);
    })
    .map((row) => row.id);
  if (ids.length === 0) return;
  const { error: delErr } = await supabase.from("messages").delete().in("id", ids);
  if (delErr) throw delErr;
}

export async function deleteAssistantErrorMessages(
  projectId: string,
  shouldDelete: (error: NonNullable<ChatMessage["error"]>) => boolean,
) {
  return deleteAssistantMessagesMatching(
    projectId,
    (message) => !!message.error && shouldDelete(message.error),
  );
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
  const { generateProjectTitle, fallbackTitle } = await import("./project-title.functions");
  let candidate = "";
  try {
    candidate = await generateProjectTitle({
      data: { prompt: firstUserPrompt ?? "", summary: summary ?? "" },
    });
  } catch {
    candidate = "";
  }
  if (!candidate) candidate = fallbackTitle(firstUserPrompt ?? "", summary ?? "");
  candidate = candidate.trim().slice(0, 60);
  if (!candidate || candidate === "Untitled project") return;
  await updateProject(project.id, {
    title: candidate,
    summary: truncateSummary(summary),
    slug: slugifyForProject(candidate, project.id),
  });
}

