/**
 * Git sync (user-owned GitHub repos).
 *
 * Distinct from mobile-github.server.ts, which pushes to Petal's own mirror
 * org via a GitHub App. Here the *user* supplies a fine-grained personal
 * access token with Contents: read/write on the target repo, and Petal
 * mirrors the project's files into it on demand.
 *
 * Worker-safe: global fetch + Web APIs only.
 */
import type { ProjectFile } from "@/server/generate.server";

const GITHUB_API = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";

function headers(token: string): HeadersInit {
  return {
    Authorization: `token ${token}`,
    Accept: ACCEPT,
    "Content-Type": "application/json",
    "User-Agent": "petal-git-sync",
  };
}

async function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res;
}

/** Validate a token and repo, returning the default branch. */
export async function verifyRepoAccess(args: {
  token: string;
  fullName: string;
}): Promise<{ defaultBranch: string; permissions: boolean }> {
  const res = await gh(args.token, `/repos/${args.fullName}`);
  const repo = (await res.json()) as {
    default_branch: string;
    permissions?: { push?: boolean };
  };
  return {
    defaultBranch: repo.default_branch || "main",
    permissions: repo.permissions?.push !== false,
  };
}

function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Ensure a branch exists; create it off the default branch when missing. */
async function ensureBranch(token: string, fullName: string, branch: string): Promise<string | null> {
  try {
    const res = await gh(token, `/repos/${fullName}/git/ref/heads/${branch}`);
    const ref = (await res.json()) as { object: { sha: string } };
    return ref.object.sha;
  } catch {
    // Fall back to the default branch tip; if the repo is completely empty
    // there is no parent commit at all.
    try {
      const { defaultBranch } = await verifyRepoAccess({ token, fullName });
      const res = await gh(token, `/repos/${fullName}/git/ref/heads/${defaultBranch}`);
      const ref = (await res.json()) as { object: { sha: string } };
      const sha = ref.object.sha;
      await gh(token, `/repos/${fullName}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      });
      return sha;
    } catch {
      return null;
    }
  }
}

/**
 * Mirror the project's files into the repo as a single commit. The tree is
 * built without `base_tree` so deletions in Petal propagate to the repo.
 */
export async function syncProjectToRepo(args: {
  token: string;
  fullName: string;
  branch: string;
  files: ProjectFile[];
  message: string;
}): Promise<{ sha: string; url: string }> {
  const { token, fullName, branch, files, message } = args;
  const parentSha = await ensureBranch(token, fullName, branch);

  const CONCURRENCY = 8;
  const blobs: Array<{ path: string; sha: string }> = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (f) => {
        const res = await gh(token, `/repos/${fullName}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: toBase64(f.content), encoding: "base64" }),
        });
        const data = (await res.json()) as { sha: string };
        return { path: f.path.replace(/^\/+/, ""), sha: data.sha };
      }),
    );
    blobs.push(...results);
  }

  const treeRes = await gh(token, `/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
    }),
  });
  const tree = (await treeRes.json()) as { sha: string };

  const commitRes = await gh(token, `/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });
  const commit = (await commitRes.json()) as { sha: string };

  if (parentSha) {
    await gh(token, `/repos/${fullName}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await gh(token, `/repos/${fullName}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return {
    sha: commit.sha,
    url: `https://github.com/${fullName}/commit/${commit.sha}`,
  };
}
