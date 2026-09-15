/**
 * Where a generated app's data actually lives.
 *
 * Every generated app talks to the same public API (`/api/public/shared/*`)
 * regardless of which database is behind it. That indirection is what makes
 * an automatic upgrade possible: when an app outgrows the shared database we
 * provision a dedicated Supabase project, copy its rows across and point this
 * resolver at the new home. The app's own code never changes.
 *
 *   shared     -> Petal's own Postgres, tables `shared_app_records` /
 *                 `shared_app_users`, every query filtered by `project_id`.
 *   dedicated  -> the project's own Supabase project, mirror tables
 *                 `app_records` / `app_users` with an identical shape.
 *
 * Server-only. Never import from client code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runQuery } from "@/server/supabase-mgmt.server";

export type ProjectStore = {
  client: SupabaseClient;
  /** Table holding app records. */
  records: string;
  /** Table holding app end users. */
  users: string;
  dedicated: boolean;
};

const SHARED_STORE = (): ProjectStore => ({
  client: supabaseAdmin as unknown as SupabaseClient,
  records: "shared_app_records",
  users: "shared_app_users",
  dedicated: false,
});

/** Short-lived cache so we don't re-read credentials on every request. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; store: ProjectStore }>();

export function invalidateStore(projectId: string): void {
  cache.delete(projectId);
}

type DedicatedCreds = { url: string; serviceRoleKey: string; ref: string };

/** Credentials for a project's own database, or null when it has none ready. */
export async function dedicatedCreds(projectId: string): Promise<DedicatedCreds | null> {
  const { data: backend } = await supabaseAdmin
    .from("project_backends")
    .select("provider, status, supabase_url, supabase_project_ref")
    .eq("project_id", projectId)
    .maybeSingle();
  if (
    !backend ||
    backend.provider !== "managed_petal" ||
    backend.status !== "ready" ||
    !backend.supabase_url ||
    !backend.supabase_project_ref
  ) {
    return null;
  }
  const { data: secret } = await supabaseAdmin
    .from("project_backend_secrets")
    .select("service_role_key")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!secret?.service_role_key) return null;
  return {
    url: backend.supabase_url,
    serviceRoleKey: secret.service_role_key,
    ref: backend.supabase_project_ref,
  };
}

/**
 * Resolve the data store for a project.
 *
 * Falls back to the shared store on ANY problem. A misconfigured dedicated
 * database must never take a live app offline — it degrades to shared rather
 * than erroring.
 */
export async function storeFor(projectId: string): Promise<ProjectStore> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.store;

  let store = SHARED_STORE();
  try {
    const creds = await dedicatedCreds(projectId);
    if (creds) {
      store = {
        client: createClient(creds.url, creds.serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        records: "app_records",
        users: "app_users",
        dedicated: true,
      };
    }
  } catch (err) {
    console.warn("[project-store] falling back to shared", projectId, err);
    store = SHARED_STORE();
  }

  cache.set(projectId, { at: Date.now(), store });
  return store;
}

/* ---------------- dedicated schema ---------------- */

const MIRROR_SCHEMA = `
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

CREATE TABLE IF NOT EXISTS public.app_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  collection TEXT NOT NULL,
  owner_key TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_records_lookup_idx
  ON public.app_records (project_id, collection, created_at DESC);

GRANT ALL ON public.app_users TO service_role;
GRANT ALL ON public.app_records TO service_role;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_records ENABLE ROW LEVEL SECURITY;
`;

/**
 * Create the mirror tables inside a project's own database. Idempotent —
 * every statement is IF NOT EXISTS, so it is safe to re-run.
 *
 * RLS is enabled with no policies on purpose: all traffic arrives through
 * Petal's API using the service role, which bypasses RLS, so nothing is
 * reachable with the anon key by accident.
 */
export async function ensureDedicatedSchema(ref: string): Promise<void> {
  await runQuery(ref, MIRROR_SCHEMA);
}

/* ---------------- data copy ---------------- */

const COPY_BATCH = 500;

export type CopyResult = { rows: number; users: number };

/**
 * Copy a project's shared-tier rows and end users into its own database.
 *
 * Runs after the mirror schema exists and before the store flips over. Ids
 * are preserved so existing client-side references keep resolving, and the
 * copy is additive — re-running it after a partial failure simply re-upserts.
 */
export async function copySharedDataToDedicated(
  projectId: string,
  target: ProjectStore,
): Promise<CopyResult> {
  if (!target.dedicated) throw new Error("copy target is not a dedicated store");

  let users = 0;
  for (let offset = 0; ; offset += COPY_BATCH) {
    const { data, error } = await supabaseAdmin
      .from("shared_app_users")
      .select("id, project_id, email, password_hash, display_name, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(offset, offset + COPY_BATCH - 1);
    if (error) throw new Error(`read shared users: ${error.message}`);
    if (!data || data.length === 0) break;
    const { error: writeErr } = await target.client
      .from(target.users)
      .upsert(data, { onConflict: "id" });
    if (writeErr) throw new Error(`write users: ${writeErr.message}`);
    users += data.length;
    if (data.length < COPY_BATCH) break;
  }

  let rows = 0;
  for (let offset = 0; ; offset += COPY_BATCH) {
    const { data, error } = await supabaseAdmin
      .from("shared_app_records")
      .select("id, project_id, collection, owner_key, data, created_at, updated_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(offset, offset + COPY_BATCH - 1);
    if (error) throw new Error(`read shared records: ${error.message}`);
    if (!data || data.length === 0) break;
    const { error: writeErr } = await target.client
      .from(target.records)
      .upsert(data, { onConflict: "id" });
    if (writeErr) throw new Error(`write records: ${writeErr.message}`);
    rows += data.length;
    if (data.length < COPY_BATCH) break;
  }

  return { rows, users };
}

/** Verify the copy landed before the shared copy is cleared. */
export async function verifyCopy(
  projectId: string,
  target: ProjectStore,
  expected: CopyResult,
): Promise<boolean> {
  const [{ count: rows }, { count: users }] = await Promise.all([
    target.client
      .from(target.records)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    target.client
      .from(target.users)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);
  return (rows ?? 0) >= expected.rows && (users ?? 0) >= expected.users;
}

/** Remove the shared-tier copy once the dedicated one is verified. */
export async function clearSharedCopy(projectId: string): Promise<void> {
  await supabaseAdmin.from("shared_app_records").delete().eq("project_id", projectId);
  await supabaseAdmin.from("shared_app_users").delete().eq("project_id", projectId);
}
