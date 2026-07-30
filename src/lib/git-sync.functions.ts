/**
 * Git sync server functions — connect a project to a GitHub repo the user
 * owns and push snapshots of the project's files to it.
 *
 * The access token never leaves the server: it's written to
 * project_git_links (service-role only) and only a masked hint is returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwnsProject } from "@/server/cloud-managed-client.server";

export type GitLink = {
  connected: boolean;
  repoFullName?: string;
  branch?: string;
  autoSync?: boolean;
  lastSyncedAt?: string | null;
  lastCommitSha?: string | null;
  lastError?: string | null;
  repoUrl?: string;
};

const ProjectInput = z.object({ projectId: z.string().uuid() });

const ConnectInput = z.object({
  projectId: z.string().uuid(),
  repoFullName: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Use the owner/repo format, e.g. jane/my-app"),
  branch: z.string().trim().min(1).max(100).default("main"),
  token: z.string().trim().min(20).max(500),
  autoSync: z.boolean().default(false),
});

export const getProjectGitLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ProjectInput.parse(data))
  .handler(async ({ data, context }): Promise<GitLink> => {
    await assertOwnsProject(context.supabase, data.projectId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("project_git_links")
      .select("repo_full_name, branch, auto_sync, last_synced_at, last_commit_sha, last_error")
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!row) return { connected: false };
    return {
      connected: true,
      repoFullName: row.repo_full_name,
      branch: row.branch,
      autoSync: row.auto_sync,
      lastSyncedAt: row.last_synced_at,
      lastCommitSha: row.last_commit_sha,
      lastError: row.last_error,
      repoUrl: `https://github.com/${row.repo_full_name}`,
    };
  });

export const connectProjectGitRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ConnectInput.parse(data))
  .handler(async ({ data, context }): Promise<GitLink & { error?: string }> => {
    await assertOwnsProject(context.supabase, data.projectId, context.userId);
    const { verifyRepoAccess } = await import("@/server/git-sync.server");

    let branch = data.branch;
    try {
      const info = await verifyRepoAccess({ token: data.token, fullName: data.repoFullName });
      if (!info.permissions) {
        return { connected: false, error: "That token can't write to this repository." };
      }
      if (!branch) branch = info.defaultBranch;
    } catch (e) {
      return {
        connected: false,
        error:
          e instanceof Error && /404/.test(e.message)
            ? "Repository not found, or the token can't see it."
            : "Couldn't reach that repository with the token provided.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("project_git_links").upsert(
      {
        project_id: data.projectId,
        provider: "github",
        repo_full_name: data.repoFullName,
        branch,
        access_token: data.token,
        auto_sync: data.autoSync,
        last_error: null,
      },
      { onConflict: "project_id" },
    );
    if (error) return { connected: false, error: error.message };

    return {
      connected: true,
      repoFullName: data.repoFullName,
      branch,
      autoSync: data.autoSync,
      lastSyncedAt: null,
      lastCommitSha: null,
      repoUrl: `https://github.com/${data.repoFullName}`,
    };
  });

export const disconnectProjectGitRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ProjectInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertOwnsProject(context.supabase, data.projectId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("project_git_links").delete().eq("project_id", data.projectId);
    return { ok: true };
  });

export const setProjectGitAutoSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ProjectInput.extend({ autoSync: z.boolean() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertOwnsProject(context.supabase, data.projectId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("project_git_links")
      .update({ auto_sync: data.autoSync })
      .eq("project_id", data.projectId);
    return { ok: !error };
  });

export const pushProjectToGit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    ProjectInput.extend({ message: z.string().trim().max(200).optional() }).parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; commitUrl?: string; sha?: string; error?: string }> => {
      await assertOwnsProject(context.supabase, data.projectId, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: link } = await supabaseAdmin
        .from("project_git_links")
        .select("repo_full_name, branch, access_token")
        .eq("project_id", data.projectId)
        .maybeSingle();
      if (!link) return { ok: false, error: "No repository connected yet." };

      const { data: files, error: filesErr } = await supabaseAdmin
        .from("project_files")
        .select("path, content")
        .eq("project_id", data.projectId);
      if (filesErr) return { ok: false, error: filesErr.message };
      if (!files?.length) return { ok: false, error: "This project has no files to push yet." };

      const { syncProjectToRepo } = await import("@/server/git-sync.server");
      try {
        const result = await syncProjectToRepo({
          token: link.access_token,
          fullName: link.repo_full_name,
          branch: link.branch,
          files: files.map((f) => ({ path: f.path, content: f.content ?? "" })),
          message: data.message?.trim() || `Sync from Petal — ${new Date().toISOString()}`,
        });
        await supabaseAdmin
          .from("project_git_links")
          .update({
            last_synced_at: new Date().toISOString(),
            last_commit_sha: result.sha,
            last_error: null,
          })
          .eq("project_id", data.projectId);
        return { ok: true, commitUrl: result.url, sha: result.sha };
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : "Push failed";
        await supabaseAdmin
          .from("project_git_links")
          .update({ last_error: message })
          .eq("project_id", data.projectId);
        return { ok: false, error: message };
      }
    },
  );
