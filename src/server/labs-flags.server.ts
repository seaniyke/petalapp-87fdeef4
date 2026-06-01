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

    // Admin short-circuit. Admins dogfood every experimental flag by
    // default — including `staged_pipeline`, `agent_loop`, and
    // `ast_patches`. These have historically been opt-in even for admins
    // out of caution (e.g. staged_pipeline once produced a collage app
    // for a "car rental" prompt), but keeping them off means we never
    // get telemetry from the people best equipped to spot regressions.
    // Admins can still turn any flag OFF explicitly via their labs_flags
    // row — if `flags[name] === false` we respect it; otherwise default on.
    const { data: claimsRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("role", "admin")
      .maybeSingle();
    if (claimsRow) {
      const { data: row } = await supabase.from("labs_flags").select("flags").maybeSingle();
      const userFlags = (row?.flags ?? {}) as LabsFlags;
      const adminFlags: LabsFlags = {};
      for (const f of ALL_FLAGS) {
        adminFlags[f] = userFlags[f] === false ? false : true;
      }
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
