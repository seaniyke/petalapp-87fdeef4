/**
 * Server-side reader for per-user Labs flags.
 *
 * The client-side `use-labs-flags` hook talks to /api/labs and is React-only;
 * server code (e.g. /api/generate orchestrator) can't use it. This helper
 * loads the same `labs_flags` row directly with the user's JWT so RLS
 * enforces ownership, and admins implicitly see every flag forced on
 * (mirrors the hook's behavior).
 *
 * Failure-tolerant: any error returns an empty flag set, so a labs-gated
 * code path simply falls back to the existing default behavior.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type LabsFlagName =
  | "integrations_marketplace"
  | "pwa_template"
  | "staged_pipeline"
  | "agent_loop"
  | "ast_patches";
export type LabsFlags = Partial<Record<LabsFlagName, boolean>>;

const ALL_FLAGS: LabsFlagName[] = [
  "integrations_marketplace",
  "pwa_template",
  "staged_pipeline",
  "agent_loop",
  "ast_patches",
];

export async function loadLabsFlagsForRequest(jwt: string | null | undefined): Promise<LabsFlags> {
  if (!jwt) return {};
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return {};

  try {
    const supabase = createClient<Database>(url, key, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Admin short-circuit. Most experimental flags are auto-on for admins
    // so they can dogfood, BUT `staged_pipeline` is explicit-opt-in only:
    // it's an unfinished alternate codepath that has produced wrong-app
    // outputs (e.g. a collage app for a "car rental" prompt). Until we're
    // confident it's better than the monolithic path, admins must turn it
    // on manually in Labs.
    const { data: claimsRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("role", "admin")
      .maybeSingle();
    if (claimsRow) {
      // Most experimental flags are auto-on for admins so they can dogfood,
      // BUT `staged_pipeline` and `agent_loop` are explicit-opt-in only:
      // both are unfinished alternate codepaths. Until they're proven
      // better than the monolithic path, admins must turn them on
      // manually in Labs.
      const optInOnly = new Set<LabsFlagName>(["staged_pipeline", "agent_loop"]);
      const adminFlags = Object.fromEntries(
        ALL_FLAGS.filter((f) => !optInOnly.has(f)).map((f) => [f, true]),
      ) as LabsFlags;
      const { data: row } = await supabase.from("labs_flags").select("flags").maybeSingle();
      const userFlags = (row?.flags ?? {}) as LabsFlags;
      if (userFlags.staged_pipeline) adminFlags.staged_pipeline = true;
      if (userFlags.agent_loop) adminFlags.agent_loop = true;
      return adminFlags;
    }

    const { data, error } = await supabase
      .from("labs_flags")
      .select("flags")
      .maybeSingle();
    if (error || !data?.flags) return {};
    return data.flags as LabsFlags;
  } catch (e) {
    console.warn("[labs-flags] load failed:", e);
    return {};
  }
}
