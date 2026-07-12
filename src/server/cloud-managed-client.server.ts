/**
 * Helpers for the per-project Cloud panel: returns a service-role Supabase
 * client pointed at the user's *managed* Supabase project (NOT Petal's own
 * backend), plus the Mgmt API ref so we can run analytics queries.
 *
 * Server-only — never import from client code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ManagedBackendInfo = {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  ref: string | null;
  status: string;
};

/**
 * Look up the project's managed backend and return enough to call its
 * service-role API. Throws a friendly error if the project doesn't have a
 * managed backend yet — the UI catches and shows an "enable backend" empty
 * state.
 */
export async function getManagedBackendForProject(
  projectId: string,
): Promise<ManagedBackendInfo> {
  const { data: row, error } = await supabaseAdmin
    .from("project_backends")
    .select(
      "provider, status, supabase_url, anon_key, supabase_project_ref",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error("NO_BACKEND");
  if (row.provider !== "managed_petal") throw new Error("NOT_MANAGED");
  if (row.status !== "ready") throw new Error("NOT_READY");

  const { data: secret, error: secretErr } = await supabaseAdmin
    .from("project_backend_secrets")
    .select("service_role_key")
    .eq("project_id", projectId)
    .maybeSingle();
  if (secretErr) throw new Error(secretErr.message);

  if (!row.supabase_url || !secret?.service_role_key || !row.anon_key) {
    throw new Error("MISSING_CREDENTIALS");
  }

  return {
    supabaseUrl: row.supabase_url,
    serviceRoleKey: secret.service_role_key,
    anonKey: row.anon_key,
    ref: row.supabase_project_ref,
    status: row.status,
  };
}


/** Build a service-role client for the project's managed Supabase. */
export function makeManagedClient(info: ManagedBackendInfo): SupabaseClient {
  return createClient(info.supabaseUrl, info.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Confirms the calling user owns this project. Use the RLS-aware client
 * passed in via `requireSupabaseAuth` middleware so we don't have to redo
 * the check ourselves.
 */
export async function assertOwnsProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not your project.");
}
