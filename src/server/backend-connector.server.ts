/**
 * Server-only helper used by the generate route to look up a project's
 * attached backend. Returns null when no backend is connected, or when the
 * backend isn't in `ready` state. Service role key is intentionally NOT
 * returned — it stays in the database for future managed features.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function lookupBackendForGenerate(projectId: string): Promise<{
  url: string;
  anonKey: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("project_backends")
    .select("status, supabase_url, anon_key")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "ready") return null;
  return { url: data.supabase_url, anonKey: data.anon_key };
}

/**
 * Shared (free) tier lookup. Returns the injection opts for
 * `sharedBackendKit` when the project has a shared backend enabled.
 */
export async function lookupSharedBackendForGenerate(projectId: string): Promise<{
  projectId: string;
  apiKey: string;
  baseUrl: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("shared_backends")
    .select("api_key, enabled")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data || data.enabled === false) return null;
  return {
    projectId,
    apiKey: data.api_key as string,
    baseUrl: process.env.PETAL_PUBLIC_ORIGIN || "https://buildwithpetal.com",
  };
}
