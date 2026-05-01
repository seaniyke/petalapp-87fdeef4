/**
 * Thin wrapper around the Supabase Management API.
 *
 * Used by the managed-backend provisioner to create projects under Petal's
 * Supabase organization, poll their lifecycle status, fetch API keys, and
 * pause/restore them when paid slots expire.
 *
 * Auth: a Personal Access Token from a Supabase org admin, stored as
 * PETAL_MGMT_PAT (we can't use SUPABASE_* — that prefix is reserved by the
 * Lovable Cloud secrets manager).
 *
 * Docs: https://api.supabase.com/api/v1
 */

const API_BASE = "https://api.supabase.com/v1";

function token(): string {
  const t = process.env.PETAL_MGMT_PAT;
  if (!t) {
    throw new Error(
      "PETAL_MGMT_PAT is not set — managed backend provisioning is disabled.",
    );
  }
  return t;
}

function orgSlug(): string {
  const s = process.env.PETAL_MGMT_ORG_SLUG;
  if (!s) throw new Error("PETAL_MGMT_ORG_SLUG is not set.");
  return s;
}

function defaultRegion(): string {
  return process.env.PETAL_MGMT_DEFAULT_REGION || "us-east-1";
}

function passwordSeed(): string {
  const s = process.env.PETAL_MGMT_DB_PASSWORD_SEED;
  if (!s || s.length < 16) {
    throw new Error(
      "PETAL_MGMT_DB_PASSWORD_SEED missing or too short (need 16+ chars).",
    );
  }
  return s;
}

async function mgmt<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Supabase Mgmt API ${method} ${path} failed (${res.status}): ${text.slice(0, 400)}`,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/* ---------- Deterministic-yet-secret DB password ---------- */

/**
 * Derive a per-project DB password from PETAL_MGMT_DB_PASSWORD_SEED + the
 * project ref. Deterministic so we can recover it later if we lose the
 * project_backends row, but unguessable without the seed. Uses Web Crypto
 * (available in the Worker runtime).
 */
export async function derivePassword(projectRef: string): Promise<string> {
  const data = new TextEncoder().encode(`${passwordSeed()}::${projectRef}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // Base64url, ~43 chars — safe for Postgres.
  const bytes = new Uint8Array(hash);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ---------- API surface ---------- */

export type MgmtProject = {
  id: string;
  ref: string;
  name: string;
  organization_id: string;
  region: string;
  created_at: string;
  status: string;
  database?: { host?: string };
};

export type MgmtApiKey = {
  name: string;
  api_key: string;
  // Newer responses also include `id` / `type` fields, but we only need the above.
};

/**
 * Create a new project under the configured organization. The DB password is
 * derived deterministically from the project ref, but Supabase requires us to
 * pass one at creation time — we generate a random one here, then on the next
 * call we'll fetch project details and reset to the derived password if we
 * ever need to share/recover it. For now we just store it in the DB.
 */
export async function createProject(args: {
  name: string;
  region?: string;
}): Promise<MgmtProject & { db_pass: string }> {
  // Use a strong random password (Supabase requires 8+ chars; we go big).
  const pwBytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (let i = 0; i < pwBytes.length; i++) bin += String.fromCharCode(pwBytes[i]);
  const db_pass = btoa(bin).replace(/[^a-zA-Z0-9]/g, "").slice(0, 28) + "Aa1!";

  const created = await mgmt<MgmtProject>("POST", "/projects", {
    name: args.name.slice(0, 60),
    organization_id: orgSlug(),
    region: args.region || defaultRegion(),
    plan: "free",
    db_pass,
  });
  return { ...created, db_pass };
}

export async function getProject(ref: string): Promise<MgmtProject | null> {
  try {
    return await mgmt<MgmtProject>("GET", `/projects/${ref}`);
  } catch (e) {
    if (e instanceof Error && /\(404\)/.test(e.message)) return null;
    throw e;
  }
}

/**
 * Returns the project's lifecycle status. Common values include:
 *   COMING_UP, ACTIVE_HEALTHY, ACTIVE_UNHEALTHY, INIT_FAILED, INACTIVE,
 *   PAUSING, RESTORING, UPGRADING, RESIZING, REMOVED, UNKNOWN.
 */
export async function getProjectStatus(ref: string): Promise<string | null> {
  const p = await getProject(ref);
  return p?.status ?? null;
}

/**
 * Fetch the project's API keys (anon + service_role). The Mgmt API exposes
 * these under /projects/{ref}/api-keys.
 */
export async function getApiKeys(ref: string): Promise<{
  anonKey: string;
  serviceRoleKey: string | null;
}> {
  const keys = await mgmt<MgmtApiKey[]>("GET", `/projects/${ref}/api-keys`);
  const anon = keys.find((k) => k.name === "anon");
  const service = keys.find((k) => k.name === "service_role");
  if (!anon) throw new Error("No anon key returned for project " + ref);
  return {
    anonKey: anon.api_key,
    serviceRoleKey: service?.api_key ?? null,
  };
}

export async function pauseProject(ref: string): Promise<void> {
  await mgmt("POST", `/projects/${ref}/pause`);
}

export async function restoreProject(ref: string): Promise<void> {
  await mgmt("POST", `/projects/${ref}/restore`);
}

export async function deleteProject(ref: string): Promise<void> {
  await mgmt("DELETE", `/projects/${ref}`);
}

/** Build the public REST URL for a Supabase project (e.g. for client.ts). */
export function projectUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/**
 * Run an arbitrary SQL statement against a managed project's Postgres via the
 * Mgmt API. Equivalent to the SQL editor — runs as the postgres role, so it
 * can create tables, policies, functions, etc.
 *
 * Returns the rows array (empty for DDL). Throws with the upstream error
 * message on failure so the caller can surface it in chat.
 */
export async function runQuery(
  ref: string,
  query: string,
): Promise<unknown[]> {
  const result = await mgmt<unknown>("POST", `/projects/${ref}/database/query`, {
    query,
  });
  return Array.isArray(result) ? result : [];
}
