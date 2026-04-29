/**
 * Marketplace auto-suggest.
 *
 * Looks at the latest user turn and surfaces installable integrations whose
 * `triggers` match. Petal's system prompt receives a short block telling it
 * to install the integration first, and the chat UI gets a structured
 * suggestion (rendered as an "Install Stripe" chip) via a streamed tag.
 *
 * Pure keyword matching — fast, deterministic, no extra model calls.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { INTEGRATIONS } from "./registry.server";

export type IntegrationSuggestion = {
  code: string;
  name: string;
  category: string;
  reason: string;
};

const STOP = new Set([
  "the","a","an","to","for","of","and","or","with","my","please","can","you",
  "i","we","add","build","make","create","need","want","help",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Score each integration against the user's most recent turn(s).
 * Returns top matches above a confidence threshold.
 */
export function suggestIntegrations(args: {
  messages: Array<{ role: string; content: unknown }>;
  installedCodes: Set<string>;
}): IntegrationSuggestion[] {
  const recentText = args.messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ")
    .toLowerCase();

  if (!recentText.trim()) return [];

  const haystackTokens = new Set(tokenize(recentText).filter((t) => !STOP.has(t)));
  const out: IntegrationSuggestion[] = [];

  for (const integ of INTEGRATIONS) {
    if (args.installedCodes.has(integ.code)) continue;
    const triggers = integ.triggers ?? [];
    if (triggers.length === 0) continue;

    let bestPhrase: string | null = null;
    for (const phrase of triggers) {
      const p = phrase.toLowerCase();
      if (recentText.includes(p)) {
        bestPhrase = phrase;
        break;
      }
      // Token-level fallback for multi-word triggers.
      const phraseTokens = tokenize(p).filter((t) => !STOP.has(t));
      if (phraseTokens.length > 0 && phraseTokens.every((t) => haystackTokens.has(t))) {
        bestPhrase = phrase;
        break;
      }
    }
    if (!bestPhrase) continue;

    out.push({
      code: integ.code,
      name: integ.name,
      category: integ.category,
      reason: `User asked about "${bestPhrase}" — ${integ.name} handles this securely.`,
    });
  }
  // Cap to 2 to keep the prompt small.
  return out.slice(0, 2);
}

/** Look up which integrations are already installed on a project. */
export async function loadInstalledCodes(projectId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("project_integrations")
    .select("integration_code")
    .eq("project_id", projectId);
  return new Set((data ?? []).map((r) => r.integration_code as string));
}

/** Render the prompt block injected for the AI. Empty string when no matches. */
export function renderSuggestionsBlock(suggestions: IntegrationSuggestion[]): string {
  if (suggestions.length === 0) return "";
  const lines = suggestions.map(
    (s) =>
      `- **${s.name}** (${s.category}) — ${s.reason} Emit \`<lov-suggest-integration code="${s.code}" />\` in your reply so the user can install it in one click. Do NOT hand-roll this capability.`,
  );
  return [
    "",
    "",
    "### Suggested integrations for this request",
    "Before writing any code that overlaps with these, recommend installing the integration first. If the user declines, then hand-roll it.",
    ...lines,
    "",
  ].join("\n");
}
