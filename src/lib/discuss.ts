/**
 * Client helper for /api/discuss.
 *
 * Discuss mode is non-streaming and non-mutating — it just returns a markdown
 * reply that we render in the chat. No phases, no file changes, no build.
 *
 * Discuss never asks the user a question — clarifying turns are routed
 * upstream by /api/triage. So this helper only returns a reply string.
 */
import { supabase } from "@/integrations/supabase/client";
import { throwIfCreditsExhausted } from "@/lib/friendly-errors";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import type { SurfaceId } from "@/lib/kimble-surfaces";

export type DiscussResult = {
  reply: string;
  /** A part of Kimble the message asked for; the builder opens it. */
  openSurface?: SurfaceId | null;
};

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
    throwIfCreditsExhausted(resp, text);
    throw new Error(text || `Request failed (${resp.status})`);
  }
  const json = (await resp.json()) as { reply?: string; openSurface?: SurfaceId | null };
  if (!json.reply) throw new Error("Empty reply from AI.");
  return { reply: json.reply, openSurface: json.openSurface ?? null };
}
