import { supabase } from "@/integrations/supabase/client";

/**
 * One-row-per-project store for Petal's in-flight assistant reply.
 *
 * Why this exists: a build can run for 30–60 seconds while Petal streams a
 * Plan, writes files, and writes a Recap. If the user refreshes mid-stream,
 * everything they were already seeing on screen disappears, leaving them
 * staring at their own prompt with no reply under it.
 *
 * The user message itself is already saved to the `messages` table before the
 * stream starts (see builder.tsx send/discuss). This module covers the *other*
 * half: persist the partial assistant text often enough that a refresh can
 * rehydrate the streaming bubble seamlessly.
 *
 * The draft is cleared in the `finally` block of every run so completed,
 * aborted, and failed builds all leave a clean slate for the next message.
 */
export type MessageDraft = {
  partial_content: string;
  partial_plan: string;
  partial_recap: string;
  updated_at: string;
};

export async function loadMessageDraft(projectId: string): Promise<MessageDraft | null> {
  const { data, error } = await supabase
    .from("message_drafts")
    .select("partial_content, partial_plan, partial_recap, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    // Non-fatal: a missing draft just means there's nothing in flight.
    console.warn("loadMessageDraft failed:", error.message);
    return null;
  }
  if (!data) return null;
  // Treat an all-empty row as "no draft" so the UI doesn't render a blank
  // streaming bubble on reload.
  if (!data.partial_content && !data.partial_plan && !data.partial_recap) {
    return null;
  }
  return data as MessageDraft;
}

export async function saveMessageDraft(
  projectId: string,
  draft: { content: string; plan: string; recap: string },
): Promise<void> {
  const { error } = await supabase
    .from("message_drafts")
    .upsert(
      {
        project_id: projectId,
        partial_content: draft.content,
        partial_plan: draft.plan,
        partial_recap: draft.recap,
      },
      { onConflict: "project_id" },
    );
  if (error) {
    // Streaming progress is a nice-to-have; never fail the run because of it.
    console.warn("saveMessageDraft failed:", error.message);
  }
}

export async function clearMessageDraft(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("message_drafts")
    .delete()
    .eq("project_id", projectId);
  if (error) {
    console.warn("clearMessageDraft failed:", error.message);
  }
}

/**
 * Lightweight debouncer for streaming writes. We don't want to upsert on every
 * token (that would be hundreds of writes per build) — once every ~600ms is
 * plenty for a refresh-recovery experience. Returns a `flush()` so callers can
 * force a final write before clearing.
 */
export function createDraftWriter(projectId: string, intervalMs = 600) {
  let pending: { content: string; plan: string; recap: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!pending) return;
      const snapshot = pending;
      pending = null;
      void saveMessageDraft(projectId, snapshot);
    }, intervalMs);
  }

  return {
    queue(next: { content: string; plan: string; recap: string }) {
      pending = next;
      schedule();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) {
        const snapshot = pending;
        pending = null;
        await saveMessageDraft(projectId, snapshot);
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
