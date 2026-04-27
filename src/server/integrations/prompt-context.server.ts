/**
 * Builds the AI system-prompt block for installed integrations.
 *
 * Mirrors the existing `backendBlock` pattern in `/api/generate`: when a
 * project has integrations installed, we tell Petal exactly which helpers
 * exist, where they live, and how to call them. Without this, the AI
 * happily reinvents `fetch("api.resend.com")` calls and hardcodes keys
 * even though the marketplace already wired everything up.
 *
 * Returns "" when nothing is installed so callers can append it
 * unconditionally.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { lookupBackendForGenerate } from "@/server/backend-connector.server";
import { getIntegration } from "./registry.server";
import type { IntegrationContext, IntegrationCredentials } from "./types";

export async function loadInstalledIntegrationsContext(
  projectId: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("project_integrations")
    .select("integration_code, options")
    .eq("project_id", projectId);
  if (error || !data || data.length === 0) return "";

  // Backend lookup is shared across all integration `aiGuidance` calls in this
  // turn — fetch once. Cheap when missing (returns null).
  const backend = await lookupBackendForGenerate(projectId);

  const blocks: string[] = [];
  for (const row of data) {
    const def = getIntegration(row.integration_code);
    if (!def || !def.aiGuidance) continue;
    const publicValues = (row.options as IntegrationCredentials | null) ?? {};
    // Secrets are intentionally NOT loaded here. aiGuidance is meant to
    // describe behavior to the AI, never leak credentials into the prompt.
    const ctx: IntegrationContext = {
      publicValues,
      secretValues: {},
      backend,
    };
    const guidance = def.aiGuidance(ctx).trim();
    if (!guidance) continue;
    blocks.push(`**${def.name} (${def.category.toLowerCase()})** — ${guidance}`);
  }

  if (blocks.length === 0) return "";

  return [
    "",
    "",
    "### Installed integrations (use these — do NOT reinvent)",
    "These capabilities are already wired into the project. When the user asks for something covered by an installed integration, you MUST use the helper described — do not call third-party APIs directly, do not hardcode keys, do not recreate files that already exist under `src/integrations/*`.",
    "",
    ...blocks,
    "",
  ].join("\n");
}
