/**
 * GitHub mirror provisioner — Petal-owned.
 *
 * Why this exists: Codemagic builds from a git repo. To make mobile builds
 * zero-config for our users, Petal owns a GitHub Org (env: PETAL_GITHUB_MIRROR_ORG)
 * and a GitHub App installed on it. Each Petal project that wants a native
 * build gets its own private repo in that org named `petal-<projectId>`.
 *
 * Auth flow (RFC 7519 + GitHub App spec):
 *  1. Mint a 9-min JWT signed RS256 with the App's private key, iss=APP_ID.
 *  2. POST /app/installations/{installationId}/access_tokens → installation
 *     access token (~1h TTL). Cache in-memory per Worker instance.
 *  3. Use that token as `Authorization: token <…>` for all repo ops.
 *
 * Worker compat: Web Crypto only. No Node `crypto` module, no `octokit` dep
 * (unbundles cleanly + adds 200KB+). All HTTP via global fetch.
 *
 * Idempotency: every operation is "create-or-get". Safe to call repeatedly
 * for the same projectId — we never duplicate repos or commits.
 */

import type { ProjectFile } from "@/server/generate.server";

const GITHUB_API = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";

// In-memory token cache, keyed by installation id. TTL is set by GitHub
// (typically 1h); we refresh 5 min early to avoid edge-case clock skew.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

/**
 * Convert a PEM-encoded PKCS#8 private key to ArrayBuffer for Web Crypto.
 * Accepts both literal `\n` and real newlines (since secrets can be pasted
 * either way).
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const b64 = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bin =
    typeof input === "string"
      ? input
      : String.fromCharCode(...input);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Mint a 9-minute App JWT (RS256). */
async function mintAppJwt(): Promise<string> {
  const appId = env("PETAL_GITHUB_APP_ID");
  const pem = env("PETAL_GITHUB_APP_PRIVATE_KEY");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: appId };

  const headerEnc = b64url(JSON.stringify(header));
  const payloadEnc = b64url(JSON.stringify(payload));
  const signingInput = `${headerEnc}.${payloadEnc}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigEnc = b64url(new Uint8Array(sig));
  return `${signingInput}.${sigEnc}`;
}

/** Get a cached/fresh installation access token. */
async function getInstallationToken(): Promise<string> {
  const installationId = env("PETAL_GITHUB_INSTALLATION_ID");
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.token;
  }
  const jwt = await mintAppJwt();
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, Accept: ACCEPT },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub installation token failed [${res.status}]: ${body}`);
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

async function gh(
  path: string,
  init: RequestInit & { allow404?: boolean } = {},
): Promise<Response> {
  const token = await getInstallationToken();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: ACCEPT,
      "Content-Type": "application/json",
      "User-Agent": "petal-mobile-builder",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok && !(init.allow404 && res.status === 404)) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${path} failed [${res.status}]: ${body}`);
  }
  return res;
}

/** Stable repo name per Petal project. Lowercase, hyphenated. */
export function repoNameForProject(projectId: string): string {
  // GitHub repo names allow [-._a-zA-Z0-9]; uuid is already safe.
  return `petal-${projectId}`;
}

/**
 * Create the mirror repo if it doesn't exist. Returns owner/repo full name.
 * Idempotent: if the repo already exists we just look it up.
 */
export async function ensureMirrorRepo(
  projectId: string,
): Promise<{ fullName: string; defaultBranch: string }> {
  const org = env("PETAL_GITHUB_MIRROR_ORG");
  const name = repoNameForProject(projectId);

  // Check if repo exists.
  const head = await gh(`/repos/${org}/${name}`, { allow404: true });
  if (head.ok) {
    const data = (await head.json()) as { full_name: string; default_branch: string };
    return { fullName: data.full_name, defaultBranch: data.default_branch ?? "main" };
  }

  // Create it. Private, no auto-init (we'll push the first commit ourselves).
  const create = await gh(`/orgs/${org}/repos`, {
    method: "POST",
    body: JSON.stringify({
      name,
      private: true,
      auto_init: true, // gives us an initial commit on `main` to base PUTs on
      description: `Petal mobile build mirror for project ${projectId}`,
    }),
  });
  const data = (await create.json()) as { full_name: string; default_branch: string };
  return { fullName: data.full_name, defaultBranch: data.default_branch ?? "main" };
}

/**
 * Push a snapshot of the current project files to the mirror repo's main
 * branch as a single commit. Uses the Git Data API (blob → tree → commit
 * → ref update) which is one logical "commit everything" operation,
 * unlike the Contents API which is one HTTP roundtrip per file.
 *
 * Returns the SHA of the new commit.
 */
export async function pushSnapshot(args: {
  fullName: string; // "org/repo"
  branch: string;
  files: ProjectFile[];
  message: string;
}): Promise<{ sha: string }> {
  const { fullName, branch, files, message } = args;

  // 1. Get current ref tip (parent commit). On a fresh auto_init repo, this
  //    points at the README commit; on an existing repo, at HEAD.
  const refRes = await gh(`/repos/${fullName}/git/ref/heads/${branch}`);
  const ref = (await refRes.json()) as { object: { sha: string } };
  const parentSha = ref.object.sha;

  // 2. Create one blob per file, in parallel. (GitHub doesn't rate-limit
  //    blob creation aggressively; for large projects we cap concurrency.)
  const CONCURRENCY = 10;
  const blobs: Array<{ path: string; sha: string }> = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (f) => {
        const res = await gh(`/repos/${fullName}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({
            // base64 to safely round-trip binary + non-UTF8 chars
            content: btoa(unescape(encodeURIComponent(f.content))),
            encoding: "base64",
          }),
        });
        const data = (await res.json()) as { sha: string };
        return { path: f.path, sha: data.sha };
      }),
    );
    blobs.push(...results);
  }

  // 3. Create a tree. base_tree=null means "this is the entire tree" — we
  //    deliberately don't set base_tree because we want the commit to mirror
  //    the project exactly (deletes happen automatically when files vanish).
  const treeRes = await gh(`/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  });
  const tree = (await treeRes.json()) as { sha: string };

  // 4. Create the commit pointing at the new tree, parented on current HEAD.
  const commitRes = await gh(`/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [parentSha],
    }),
  });
  const commit = (await commitRes.json()) as { sha: string };

  // 5. Fast-forward the branch ref. force=false because we always parent on
  //    the latest, so this should never need to be a force-push.
  await gh(`/repos/${fullName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { sha: commit.sha };
}
