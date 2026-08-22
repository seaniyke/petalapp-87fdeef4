/**
 * Server-side safety net for builds whose browser went away.
 *
 * The assistant reply in the chat thread is normally written by the client
 * (`appendMessages` in builder.tsx) once the SSE stream completes. That is
 * fine while the tab is open — but if the user closes the tab, locks their
 * phone, or the socket drops, the pipeline keeps running server-side, files
 * land in the project… and the conversation is left with a user prompt and no
 * answer. Coming back to a thread that looks like Petal ignored you is the
 * single worst impression the product can make.
 *
 * So when the stream notices the client is gone, it calls
 * `persistAbandonedTurnReply()` from the same `finally` block that writes the
 * terminal turn status. The message is written with the service-role client
 * (no user session is available at that point) and encoded exactly like the
 * client encodes structured assistant messages, so `loadProjectMessages`
 * decodes it with no special-casing.
 *
 * Idempotency: the row carries the turn id inside the structured payload and
 * we refuse to write twice for the same turn, so a client that reconnects and
 * replays the turn cannot produce a duplicate bubble.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const STRUCTURED_PREFIX = "@@petal/v1:";

let cached: SupabaseClient<Database> | null = null;

function admin(): SupabaseClient<Database> | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type AbandonedTurnReply = {
  projectId: string;
  turnId: string;
  status: "succeeded" | "failed" | "aborted";
  summary?: string | null;
  plan?: string | null;
  recap?: string | null;
  errorMessage?: string | null;
};

function bodyFor(input: AbandonedTurnReply): string {
  if (input.status === "succeeded") {
    return (
      input.summary?.trim() ||
      "Finished this build while you were away — your files are saved and the preview is up to date."
    );
  }
  const detail = input.errorMessage?.trim();
  return detail
    ? `This build didn't finish: ${detail.slice(0, 300)}`
    : "This build didn't finish. Nothing was charged — ask again and Petal will pick it back up.";
}

/**
 * Write the assistant reply for a turn whose client disconnected. No-ops when
 * the service-role key is absent, when a reply for this turn already exists,
 * or on any failure — this must never break the build it is trying to rescue.
 */
export async function persistAbandonedTurnReply(
  input: AbandonedTurnReply,
): Promise<boolean> {
  const client = admin();
  if (!client) return false;
  try {
    // Already written (double-fire, or a reconnected client beat us to it).
    const { data: existing } = await client
      .from("messages")
      .select("id, role, content")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false })
      .limit(8);
    if ((existing ?? []).some((row) => row.content?.includes(input.turnId))) {
      return false;
    }
    // If the newest stored message is already an assistant reply, the client
    // landed its own write before dying — don't stack a second bubble.
    if ((existing ?? [])[0]?.role === "assistant") return false;

    const payload = JSON.stringify({
      content: bodyFor(input),
      plan: input.plan ?? null,
      recap: input.recap ?? null,
      suggestions: null,
      error:
        input.status === "succeeded"
          ? null
          : { kind: "build_failed", detail: (input.errorMessage ?? "").slice(0, 500) },
      turnId: input.turnId,
    });

    const { error } = await client.from("messages").insert({
      project_id: input.projectId,
      role: "assistant",
      content: STRUCTURED_PREFIX + payload,
    });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}
