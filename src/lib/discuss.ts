/**
 * Client helper for /api/discuss.
 *
 * Discuss mode is non-streaming and non-mutating — it just returns a markdown
 * reply that we render in the chat. No phases, no file changes, no build.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";

export type DiscussResult = { reply: string; suggestions: string[] };

export async function requestDiscussion(
  body: {
    messages: ChatMessage[];
    currentFiles: ProjectFile[];
    customInstructions?: string;
  },
  signal?: AbortSignal,
): Promise<DiscussResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const resp = await fetch("/api/discuss", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed (${resp.status})`);
  }
  const json = (await resp.json()) as { reply?: string; suggestions?: string[] };
  if (!json.reply) throw new Error("Empty reply from AI.");
  return {
    reply: json.reply,
    suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
  };
}
