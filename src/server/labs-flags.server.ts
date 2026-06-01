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

    // Global defaults — `staged_pipeline` and `ast_patches` are now ON
    // for every signed-in user unless they explicitly opted out
    // (`flags[name] === false`). They graduated out of admin-only labs
    // after enough dogfood telemetry showed parity-or-better outcomes.
    // `agent_loop` remains admin-default-on / user-opt-in because each
    // step is billed and the tool surface is still settling. Other
    // experimental flags (integrations_marketplace, pwa_template) stay
    // strictly opt-in.
    const GLOBAL_DEFAULT_ON: LabsFlagName[] = ["staged_pipeline", "ast_patches"];
    const ADMIN_DEFAULT_ON: LabsFlagName[] = ["agent_loop"];

    const { data: claimsRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = Boolean(claimsRow);

    const { data: row } = await supabase
      .from("labs_flags")
      .select("flags")
      .maybeSingle();
    const userFlags = (row?.flags ?? {}) as LabsFlags;

    const resolved: LabsFlags = {};
    for (const f of ALL_FLAGS) {
      const explicit = userFlags[f];
      if (explicit === false) {
        resolved[f] = false;
        continue;
      }
      if (explicit === true) {
        resolved[f] = true;
        continue;
      }
      if (GLOBAL_DEFAULT_ON.includes(f)) {
        resolved[f] = true;
      } else if (isAdmin && ADMIN_DEFAULT_ON.includes(f)) {
        resolved[f] = true;
      }
    }
    return resolved;
  } catch (e) {
    console.warn("[labs-flags] load failed:", e);
    return {};
  }
}
