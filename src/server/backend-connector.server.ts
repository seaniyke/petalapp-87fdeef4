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
/**
 * Every generated app on the shared tier bakes in the address of Kimble's own
 * API. A single hardcoded address is a single point of failure: if that
 * hostname is ever pointed at an older deployment, every published app loses
 * its sign-in at once. So we ship a primary plus stable backups, and the
 * client walks the list until one answers.
 */
const PUBLISHED_ORIGIN = "https://petalapp.lovable.app";
const STABLE_ORIGIN = "https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app";
/** Hosts that no longer serve Petal's API — never baked into a generated app. */
const RETIRED_ORIGINS = /^https?:\/\/(www\.)?(kimble\.cloud|buildwithpetal\.com)\/?$/i;

export function sharedApiOrigins(
  env: Record<string, string | undefined> = process.env,
): { baseUrl: string; fallbackUrls: string[] } {
  const configured = (env.PETAL_PUBLIC_ORIGIN || "").trim();
  const extra = (env.PETAL_FALLBACK_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // kimble.cloud answers 404 for every API path and buildwithpetal.com
  // serves an older deployment that rejects valid project keys. Either one
  // first in the list made every page log a failed request, and the build
  // server's browser check refused to publish the site.
  const all = [configured, PUBLISHED_ORIGIN, STABLE_ORIGIN, ...extra]
    .filter((u) => u && !RETIRED_ORIGINS.test(u))
    .filter(Boolean)
    .map((u) => u.replace(/\/$/, ""));
  const unique = Array.from(new Set(all));
  return { baseUrl: unique[0]!, fallbackUrls: unique.slice(1) };
}

export async function lookupSharedBackendForGenerate(projectId: string): Promise<{
  projectId: string;
  apiKey: string;
  baseUrl: string;
  fallbackUrls: string[];
} | null> {
  const { data, error } = await supabaseAdmin
    .from("shared_backends")
    .select("api_key")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    projectId,
    apiKey: data.api_key as string,
    ...sharedApiOrigins(),
  };
}
