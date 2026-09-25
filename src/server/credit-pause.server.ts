import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { ProjectFile } from "@/server/generate.server";
import { persistAbandonedTurnReply } from "@/server/abandoned-turn-reply.server";
import { markStage } from "@/server/turn-completion.server";

export type CreditPauseRow = {
  id: string;
  turn_id: string;
  project_id: string;
  user_id: string;
  status: "awaiting_credits" | "parked" | "applying" | "completed" | "superseded" | "failed";
  required_credits: number;
  baseline_hash: string;
  candidate_files: ProjectFile[];
  result_payload: Record<string, unknown>;
  created_at: string;
};

export function projectFilesHash(files: ProjectFile[]): string {
  const canonical = [...files]
    .map((file) => ({ path: file.path.trim(), content: file.content ?? "" }))
    .filter((file) => file.path.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function saveCreditPause(input: {
  turnId: string;
  projectId: string;
  userId: string;
  requiredCredits: number;
  baselineFiles: ProjectFile[];
  candidateFiles: ProjectFile[];
  resultPayload: Record<string, unknown>;
  originalRequest: string;
}): Promise<string> {
  await supabaseAdmin.from("credit_paused_turns").update({ status: "superseded" })
    .eq("project_id", input.projectId).eq("user_id", input.userId)
    .in("status", ["awaiting_credits", "parked"]);
  const { data, error } = await supabaseAdmin.from("credit_paused_turns").insert({
    turn_id: input.turnId,
    project_id: input.projectId,
    user_id: input.userId,
    required_credits: input.requiredCredits,
    baseline_hash: projectFilesHash(input.baselineFiles),
    candidate_files: input.candidateFiles as unknown as Json,
    result_payload: input.resultPayload as Json,
    original_request: input.originalRequest,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the build checkpoint");
  return data.id;
}

export async function listCreditPauses(userId: string, projectId?: string): Promise<CreditPauseRow[]> {
  let query = supabaseAdmin.from("credit_paused_turns").select("*").eq("user_id", userId)
    .in("status", ["awaiting_credits", "parked"]).order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CreditPauseRow[];
}

export async function parkCreditPause(id: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("credit_paused_turns").update({ status: "parked" })
    .eq("id", id).eq("user_id", userId).eq("status", "awaiting_credits").select("id");
  return Boolean(data && data.length > 0);
}

export async function resumeCreditPause(id: string): Promise<{ ok: boolean; reason?: "not_ready" | "project_changed" | "apply_failed"; projectId?: string; turnId?: string }> {
  const { data: before } = await supabaseAdmin.from("credit_paused_turns").select("*").eq("id", id).maybeSingle();
  const pause = before as CreditPauseRow | null;
  if (!pause || !["awaiting_credits", "parked", "applying"].includes(pause.status)) return { ok: false, reason: "not_ready" };

  const { data: current } = await supabaseAdmin.from("project_files").select("path,content").eq("project_id", pause.project_id);
  if (projectFilesHash((current ?? []) as ProjectFile[]) !== pause.baseline_hash) {
    await supabaseAdmin.from("credit_paused_turns").update({ status: "superseded" }).eq("id", id);
    return { ok: false, reason: "project_changed", projectId: pause.project_id };
  }

  const alreadyClaimed = pause.status === "applying";
  const { data: claimed, error: claimError } = alreadyClaimed
    ? { data: null, error: null }
    : await supabaseAdmin.rpc("claim_credit_paused_turn", { _checkpoint_id: id });
  const claim = (alreadyClaimed ? {
    checkpoint_id: pause.id,
    project_id: pause.project_id,
    turn_id: pause.turn_id,
    candidate_files: pause.candidate_files,
  } : (Array.isArray(claimed) ? claimed[0] : claimed)) as unknown as {
    checkpoint_id: string; project_id: string; turn_id: string; candidate_files: ProjectFile[];
  } | undefined;
  if (claimError || !claim) return { ok: false, reason: "not_ready" };

  try {
    const { error } = await supabaseAdmin.rpc("replace_project_files", {
      _project_id: claim.project_id,
      _files: claim.candidate_files as never,
      // Records turn.committed_revision in the same transaction. The base
      // check is off: this path has its own baseline-hash drift check above.
      _turn_id: claim.turn_id,
      _check_base: false,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("credit_paused_turns").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id).eq("status", "applying");
    await supabaseAdmin.from("turns").update({ status: "succeeded", ended_at: new Date().toISOString(), credits_charged: pause.required_credits }).eq("id", claim.turn_id);
    await markStage(claim.project_id, "building");
    const payload = pause.result_payload;
    await persistAbandonedTurnReply({
      projectId: claim.project_id,
      turnId: claim.turn_id,
      status: "succeeded",
      summary: typeof payload.summary === "string" ? payload.summary : "Credits received — I finished and saved your build.",
      plan: typeof payload.plan === "string" ? payload.plan : null,
      recap: typeof payload.recap === "string" ? payload.recap : null,
    });
    return { ok: true, projectId: claim.project_id, turnId: claim.turn_id };
  } catch (error) {
    // Keep the charged checkpoint recoverable. Re-applying the complete file
    // snapshot is idempotent; a payment callback or cron retry can finish it.
    await supabaseAdmin.from("credit_paused_turns").update({ last_error: error instanceof Error ? error.message.slice(0, 500) : "Apply failed" }).eq("id", id).eq("status", "applying");
    return { ok: false, reason: "apply_failed", projectId: claim.project_id };
  }
}

export async function resumeCreditPausesForUser(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("credit_paused_turns").select("*").eq("user_id", userId)
    .in("status", ["awaiting_credits", "parked", "applying"]).order("created_at", { ascending: true });
  const pauses = (data ?? []) as unknown as CreditPauseRow[];
  const resumed: string[] = [];
  for (const pause of pauses) {
    const result = await resumeCreditPause(pause.id);
    if (result.ok && result.projectId) resumed.push(result.projectId);
  }
  return resumed;
}

/** Recover checkpoints charged by a worker that stopped before files landed. */
export async function recoverApplyingCreditPauses(limit = 3): Promise<string[]> {
  const { data } = await supabaseAdmin.from("credit_paused_turns").select("id")
    .eq("status", "applying").order("claimed_at", { ascending: true }).limit(limit);
  const resumed: string[] = [];
  for (const row of data ?? []) {
    const result = await resumeCreditPause(row.id);
    if (result.ok && result.projectId) resumed.push(result.projectId);
  }
  return resumed;
}