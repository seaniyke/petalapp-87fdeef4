/**
 * Edit history (Edit Intelligence, phase 6) + focus persistence (phase 3).
 *
 * One row per chat edit: what the user asked, the change set Kimble understood,
 * what it was told to preserve, which files actually changed, whether every
 * part landed, and the version to return to if the edit has to be undone.
 *
 * It doubles as the store for the conversation focus, so "make the button
 * white too" can be resolved on the next turn without a second table.
 *
 * Everything fails open — bookkeeping must never break a build.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ChangeSet } from "@/server/change-set.server";
import type { EditFocus } from "@/server/edit-focus.server";
import type { AuditResult } from "@/server/edit-audit.server";

export interface EditRecordInput {
  projectId: string;
  turnId?: string | null;
  buildId?: string | null;
  userRequest: string;
  changeSet: ChangeSet;
  audit: AuditResult;
  focus: EditFocus | null;
  /** Snapshot reference that undoes just this edit. */
  revertTo?: { paths: string[]; files: Array<{ path: string; content: string }> } | null;
}

export async function recordEdit(input: EditRecordInput): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("project_edit_history")
      .insert({
        project_id: input.projectId,
        turn_id: input.turnId ?? null,
        build_id: input.buildId ?? null,
        user_request: input.userRequest.slice(0, 8000),
        change_set: input.changeSet.items as unknown as never,
        preserve: input.changeSet.preserve as unknown as never,
        changed_paths: input.audit.changedPaths as unknown as never,
        audit: {
          met: input.audit.met.map((m) => m.id),
          unmet: input.audit.unmet.map((u) => ({ id: u.id, text: u.text })),
          violations: input.audit.violations.map((v) => ({
            text: v.preserve.text,
            paths: v.paths,
          })),
        } as unknown as never,
        focus: (input.focus ?? null) as unknown as never,
        complete: input.audit.unmet.length === 0,
        revert_to: (input.revertTo ?? null) as unknown as never,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[edit-history] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.warn("[edit-history] insert threw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Most recent conversation focus for a project, or null. */
export async function loadEditFocus(projectId: string): Promise<EditFocus | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("project_edit_history")
      .select("focus")
      .eq("project_id", projectId)
      .not("focus", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.focus) return null;
    const focus = data.focus as unknown as EditFocus;
    if (!focus?.target || typeof focus.at !== "number") return null;
    return focus;
  } catch {
    return null;
  }
}

/** Recent edits for a project, newest first. Used by the history UI. */
export async function listEdits(projectId: string, limit = 20) {
  try {
    const { data, error } = await supabaseAdmin
      .from("project_edit_history")
      .select("id, created_at, user_request, change_set, changed_paths, audit, complete")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
