/**
 * Durable build checkpoints (first builds).
 *
 * A long first build writes its shared layout (the "shell" answer) and then
 * each page with its own model call. Every finished, structurally whole piece
 * is saved here AS IT FINISHES. Nothing here is committed to the project:
 * checkpointed files are only ever re-staged into a later turn's transaction,
 * which then runs every verification gate and the revision-guarded commit as
 * usual. So a checkpoint can save work, never skip a check.
 *
 * Lifecycle: active (being written by its turn) → resumable (worker lost;
 * set by reap_stalled_turns) → resuming (claimed by exactly one new turn, which
 * becomes the owner) → consumed (committed) | discarded (stale/unusable).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProjectFile } from "@/server/generate.server";

type Db = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any };
const db = () => supabaseAdmin as unknown as Db;

export interface ShellSnapshot {
  name: string | null;
  args: string;
  text: string;
  finishReason: string | null;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  user_id: string;
  origin_turn_id: string;
  turn_id: string;
  base_revision: number | null;
  request: string;
  stage: string;
  shell: ShellSnapshot | null;
  planned: Array<{ route: string; file: string }>;
  pages: Record<string, string>;
  status: string;
  /** "partial" = kept after a stopped build whose work was already billed. */
  terminal_outcome?: string | null;
  resume_count: number;
  created_at: string;
  updated_at: string;
}

export interface PreservedWork {
  pages: number;
  files: number;
  aiCalls: number;
  costUsd: number;
  elapsedMs: number;
}

async function projectRevision(projectId: string): Promise<number | null> {
  const { data } = await db().from("projects").select("revision").eq("id", projectId).maybeSingle();
  const r = (data as { revision?: number | string | null } | null)?.revision;
  return r == null ? null : Number(r);
}

/** Open (or take over) this turn's checkpoint with the shell answer. */
export async function saveShellCheckpoint(args: {
  projectId: string;
  userId: string;
  turnId: string;
  request: string;
  shell: ShellSnapshot;
  planned: Array<{ route: string; file: string }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: existing } = await db()
      .from("build_checkpoints")
      .select("id,turn_id,status")
      .eq("project_id", args.projectId)
      .in("status", ["active", "resumable", "resuming"])
      .maybeSingle();
    if (existing) {
      // A resumed turn keeps its checkpoint; any other live one is stale.
      if ((existing as { turn_id: string }).turn_id === args.turnId) return { ok: true };
      await db().from("build_checkpoints").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", (existing as { id: string }).id);
    }
    const { error } = await db().from("build_checkpoints").insert({
      project_id: args.projectId,
      user_id: args.userId,
      origin_turn_id: args.turnId,
      turn_id: args.turnId,
      base_revision: await projectRevision(args.projectId),
      request: args.request.slice(0, 20_000),
      stage: "pages",
      shell: args.shell,
      planned: args.planned,
      remaining: args.planned.map((p) => p.file),
    });
    if (error) {
      console.error("[checkpoint] shell save failed", error.message);
      return { ok: false, error: String(error.message).slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    console.error("[checkpoint] shell save failed", (e as Error).message);
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

/** Merge finished files; only the owning turn can write. */
export async function checkpointFiles(turnId: string, files: ProjectFile[], remaining?: string[]): Promise<boolean> {
  if (!files.length) return false;
  try {
    const pages: Record<string, string> = {};
    for (const f of files) pages[f.path] = f.content;
    const { data, error } = await db().rpc("checkpoint_merge_pages", {
      _turn_id: turnId,
      _pages: pages,
      _remaining: remaining ?? null,
      _stage: null,
    });
    if (error) console.error("[checkpoint] merge failed", error.message);
    return !error && data === true;
  } catch (e) {
    console.error("[checkpoint] merge failed", (e as Error).message);
    return false;
  }
}

export async function loadResumableCheckpoint(projectId: string): Promise<Checkpoint | null> {
  const { data } = await db()
    .from("build_checkpoints")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "resumable")
    .maybeSingle();
  return (data as Checkpoint | null) ?? null;
}

/** Pure: can this checkpoint be resumed against the project as it is now? */
export function checkpointUsable(cp: Pick<Checkpoint, "shell" | "base_revision">, currentRevision: number | null): { ok: true } | { ok: false; reason: string } {
  if (!cp.shell || !cp.shell.args) return { ok: false, reason: "no shell saved" };
  if (cp.base_revision != null && currentRevision != null && cp.base_revision !== currentRevision) {
    return { ok: false, reason: "project changed since the checkpoint" };
  }
  return { ok: true };
}

/**
 * Claim a resumable checkpoint for a new turn (CAS resumable → resuming).
 * Exactly one turn wins; the winner becomes the only writer.
 */
export async function claimCheckpoint(checkpointId: string, projectId: string, newTurnId: string): Promise<{ checkpoint: Checkpoint; preserved: PreservedWork } | null> {
  try {
    const { data: row } = await db().from("build_checkpoints").select("*").eq("id", checkpointId).eq("project_id", projectId).maybeSingle();
    const cp = row as Checkpoint | null;
    if (!cp || cp.status !== "resumable") return null;
    const usable = checkpointUsable(cp, await projectRevision(projectId));
    if (!usable.ok) {
      await db().from("build_checkpoints").update({ status: "discarded", terminal_outcome: usable.reason.includes("changed") ? "revision_mismatch" : "unusable", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", cp.id).eq("status", "resumable");
      console.warn(`[checkpoint] discarded ${cp.id}: ${usable.reason}`);
      return null;
    }
    const preserved = await measurePreserved(cp);
    const { data: won } = await db()
      .from("build_checkpoints")
      .update({ status: "resuming", turn_id: newTurnId, resume_count: cp.resume_count + 1, preserved, updated_at: new Date().toISOString() })
      .eq("id", cp.id)
      .eq("status", "resumable")
      .select("id")
      .maybeSingle();
    if (!won) return null;
    return { checkpoint: { ...cp, turn_id: newTurnId, status: "resuming" }, preserved };
  } catch (e) {
    console.warn("[checkpoint] claim failed", (e as Error).message);
    return null;
  }
}

/** Work the checkpoint saves: every AI call of the interrupted turn(s) up to
 *  the last saved piece, which a restart from zero would have to pay again. */
async function measurePreserved(cp: Checkpoint): Promise<PreservedWork> {
  const pages = Object.keys(cp.pages ?? {});
  const plannedFiles = new Set((cp.planned ?? []).map((p) => p.file));
  let aiCalls = 0;
  let costUsd = 0;
  try {
    const { data } = await db()
      .from("ai_call_log")
      .select("cost_usd_micro,created_at")
      .eq("turn_id", cp.turn_id)
      .lte("created_at", cp.updated_at);
    for (const r of (data ?? []) as Array<{ cost_usd_micro: number | null }>) {
      aiCalls += 1;
      costUsd += Number(r.cost_usd_micro ?? 0) / 1e6;
    }
  } catch {
    /* metrics are evidence, never a gate */
  }
  const prior = (cp as unknown as { preserved?: Partial<PreservedWork> }).preserved ?? {};
  return {
    pages: pages.filter((p) => plannedFiles.has(p)).length,
    files: pages.length + 1,
    aiCalls: aiCalls + (prior.aiCalls ?? 0),
    costUsd: Math.round((costUsd + (prior.costUsd ?? 0)) * 1e6) / 1e6,
    elapsedMs: new Date(cp.updated_at).getTime() - new Date(cp.created_at).getTime() + (prior.elapsedMs ?? 0),
  };
}

/** Files to re-stage: the checkpointed pages, which the page writer skips. */
export function checkpointSeedFiles(cp: Pick<Checkpoint, "pages">, shellFiles: ProjectFile[]): ProjectFile[] {
  const pages = cp.pages ?? {};
  const byPath = new Map(shellFiles.map((f) => [f.path, f]));
  for (const [path, content] of Object.entries(pages)) {
    // The router is always taken from the shell answer + writer; a saved
    // page never overrides it.
    if (path === "src/App.tsx" && byPath.has(path)) continue;
    byPath.set(path, { path, content });
  }
  return [...byPath.values()];
}

export async function markCheckpointConsumed(turnId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db().from("build_checkpoints").update({ status: "consumed", terminal_outcome: "committed", closed_at: now, updated_at: now }).eq("turn_id", turnId).in("status", ["active", "resuming"]);
  } catch {
    /* best-effort */
  }
}

/** In-process infrastructure failure: hand the checkpoint to the resume worker. */
/** Keep a stopped-but-valid first build's saved work for the next attempt. */
export async function markCheckpointPartial(turnId: string): Promise<boolean> {
  try {
    const { data } = await db()
      .from("build_checkpoints")
      .update({ status: "resumable", terminal_outcome: "partial", updated_at: new Date().toISOString() })
      .eq("turn_id", turnId)
      .in("status", ["active", "resuming"])
      .not("shell", "is", null)
      .select("id")
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function markCheckpointResumable(turnId: string): Promise<boolean> {
  try {
    const { data } = await db()
      .from("build_checkpoints")
      .update({ status: "resumable", updated_at: new Date().toISOString() })
      .eq("turn_id", turnId)
      .in("status", ["active", "resuming"])
      .not("shell", "is", null)
      .select("id")
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Checkpoint statuses that are still live (may be resumed or written). */
export const LIVE_CHECKPOINT_STATUSES = ["active", "resumable", "resuming"] as const;

/** Pure: the terminal state a live checkpoint takes when its turn ends.
 *  Committed → consumed; every other terminal outcome → discarded with the
 *  reason kept. Transient infrastructure loss is NOT terminal (it goes to
 *  resumable via markCheckpointResumable) and returns null here. */
export function retirementFor(outcome: string): { status: "consumed" | "discarded"; terminal_outcome: string } | null {
  if (outcome === "resumable" || outcome === "worker_lost") return null;
  return { status: outcome === "committed" ? "consumed" : "discarded", terminal_outcome: outcome.slice(0, 80) };
}

/**
 * Close this turn's live checkpoint with its terminal outcome. The row (and
 * its saved pages) is kept as evidence; it just can never be resumed again.
 */
export async function retireCheckpoint(turnId: string, outcome: string): Promise<boolean> {
  const r = retirementFor(outcome);
  if (!r) return false;
  try {
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from("build_checkpoints")
      .update({ ...r, closed_at: now, updated_at: now })
      .eq("turn_id", turnId)
      .in("status", [...LIVE_CHECKPOINT_STATUSES])
      .select("id");
    if (error) console.error("[checkpoint] retire failed", error.message);
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error("[checkpoint] retire failed", (e as Error).message);
    return false;
  }
}
