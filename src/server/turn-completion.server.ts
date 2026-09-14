/**
 * Server-owned completion record for one user request ("turn").
 *
 * Why this exists
 * ---------------
 * The inspect -> fix -> rebuild -> retest cycle used to live entirely in the
 * builder page: attempt counters in React refs, mirrored to session storage.
 * Close the tab and the loop died, leaving the project broken with nobody
 * retrying. The budget was also per browser session, so the same project could
 * re-enter the loop unevenly.
 *
 * This module moves the *authority* to the server. The client loop keeps
 * running as the live progress view (it is faster and it can narrate), but the
 * durable state — stage, attempts, outstanding defects, why we stopped — lives
 * in `project_turn_completion`. A scheduled worker can pick up any record that
 * is still unfinished after the grace window and carry it to completion.
 *
 * Everything here fails open: a write that throws logs and returns. Petal's
 * existing behaviour must never regress because bookkeeping had a bad day.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CompletionStage =
  | "generating"
  | "building"
  | "needs_repair"
  | "repairing"
  | "delivered"
  | "blocked"
  | "budget_spent"
  | "superseded";

const TERMINAL: CompletionStage[] = [
  "delivered",
  "blocked",
  "budget_spent",
  "superseded",
];

/** Default autonomous rounds per user request, enforced server-side. */
export const MAX_COMPLETION_ATTEMPTS = 3;

/**
 * How long the server waits before taking over a repair itself. The browser
 * loop is usually faster and narrates progress, so give it first refusal;
 * only step in when nobody did.
 */
const CLIENT_GRACE_MS = 90_000;

export interface CompletionRecord {
  id: string;
  project_id: string;
  turn_id: string;
  user_id: string;
  stage: CompletionStage;
  attempts: number;
  max_attempts: number;
  outstanding_defects: string[];
  defect_fingerprint: string | null;
  last_build_id: string | null;
  accepted: boolean;
  evidence: string[];
  terminal_reason: string | null;
  resume_after: string | null;
}

function asRecord(row: Record<string, unknown>): CompletionRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    turn_id: String(row.turn_id),
    user_id: String(row.user_id),
    stage: row.stage as CompletionStage,
    attempts: Number(row.attempts ?? 0),
    max_attempts: Number(row.max_attempts ?? MAX_COMPLETION_ATTEMPTS),
    outstanding_defects: Array.isArray(row.outstanding_defects)
      ? (row.outstanding_defects as string[])
      : [],
    defect_fingerprint: (row.defect_fingerprint as string | null) ?? null,
    last_build_id: (row.last_build_id as string | null) ?? null,
    accepted: Boolean(row.accepted),
    evidence: Array.isArray(row.evidence) ? (row.evidence as string[]) : [],
    terminal_reason: (row.terminal_reason as string | null) ?? null,
    resume_after: (row.resume_after as string | null) ?? null,
  };
}

/**
 * Stable identity for a defect set. Two consecutive rounds producing the same
 * fingerprint means the fix changed nothing — retrying the same approach burns
 * credits for no benefit, so the caller escalates or stops instead.
 */
export function fingerprintDefects(defects: string[]): string {
  const normalized = [...defects]
    .map((d) => d.toLowerCase().replace(/[0-9]+/g, "#").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort();
  if (!normalized.length) return "clean";
  let hash = 0;
  const joined = normalized.join("|");
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 31 + joined.charCodeAt(i)) | 0;
  }
  return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Open (or reuse) the record for a turn, and retire any older open record for
 * the same project — one user request owns the loop at a time.
 */
export async function openTurnCompletion(args: {
  projectId: string;
  userId: string;
  turnId: string;
  /** Carried over when this turn is itself an autonomous repair round. */
  inheritAttempts?: number;
  /**
   * True when Petal started this turn itself to fix its own output. A repair
   * continues the previous request's budget; a message the user actually typed
   * starts a fresh one.
   */
  isAutoFix?: boolean;
}): Promise<CompletionRecord | null> {
  try {
    let attempts = args.inheritAttempts ?? 0;
    if (args.isAutoFix) {
      const previous = await loadOpenCompletion(args.projectId);
      if (previous && previous.turn_id !== args.turnId) {
        const spent =
          previous.stage === "needs_repair" || previous.stage === "repairing"
            ? previous.attempts + 1
            : previous.attempts;
        attempts = Math.max(attempts, spent);
      }
    }

    await supabaseAdmin
      .from("project_turn_completion")
      .update({ stage: "superseded", terminal_reason: "a newer request took over" })
      .eq("project_id", args.projectId)
      .neq("turn_id", args.turnId)
      .not("stage", "in", `(${TERMINAL.join(",")})`);

    const { data, error } = await supabaseAdmin
      .from("project_turn_completion")
      .upsert(
        {
          project_id: args.projectId,
          user_id: args.userId,
          turn_id: args.turnId,
          stage: "generating",
          attempts,
          outstanding_defects: [],
          terminal_reason: null,
          resume_after: null,
        } as never,
        { onConflict: "turn_id" },
      )
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? asRecord(data as Record<string, unknown>) : null;
  } catch (e) {
    console.warn("[turn-completion] open failed", (e as Error).message);
    return null;
  }
}

/** The record currently owning the loop for a project, if any. */
export async function loadOpenCompletion(
  projectId: string,
): Promise<CompletionRecord | null> {
  try {
    const { data } = await supabaseAdmin
      .from("project_turn_completion")
      .select("*")
      .eq("project_id", projectId)
      .not("stage", "in", `(${TERMINAL.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? asRecord(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function markStage(
  projectId: string,
  stage: CompletionStage,
  patch: Partial<Record<string, unknown>> = {},
): Promise<void> {
  try {
    const open = await loadOpenCompletion(projectId);
    if (!open) return;
    await supabaseAdmin
      .from("project_turn_completion")
      .update({ stage, ...patch } as never)
      .eq("id", open.id);
  } catch (e) {
    console.warn("[turn-completion] stage write failed", (e as Error).message);
  }
}

/**
 * The acceptance decision. A turn is only "delivered" when the build shipped
 * AND the browser check proved the app actually works — routes rendered, the
 * declared user flows completed, no blocking defect left. Anything short of
 * that keeps the record open so the loop (client or server) continues.
 */
export async function recordBuildOutcome(args: {
  projectId: string;
  buildId: string;
  shipped: boolean;
  blockingDefects: string[];
  evidence?: string[];
  reason?: string | null;
}): Promise<void> {
  try {
    const open = await loadOpenCompletion(args.projectId);
    if (!open) return;

    const accepted = args.shipped && args.blockingDefects.length === 0;
    const fingerprint = fingerprintDefects(args.blockingDefects);

    if (accepted) {
      await supabaseAdmin
        .from("project_turn_completion")
        .update({
          stage: "delivered",
          accepted: true,
          outstanding_defects: [],
          defect_fingerprint: "clean",
          last_build_id: args.buildId,
          evidence: args.evidence ?? [],
          terminal_reason: null,
          resume_after: null,
        } as never)
        .eq("id", open.id);
      return;
    }

    // No progress since last round: the same defects came back. Retrying an
    // identical approach is the loop we promised never to run.
    const stalled =
      open.defect_fingerprint === fingerprint && open.attempts > 0 && fingerprint !== "clean";
    if (stalled || open.attempts >= open.max_attempts) {
      await supabaseAdmin
        .from("project_turn_completion")
        .update({
          stage: stalled ? "blocked" : "budget_spent",
          accepted: false,
          outstanding_defects: args.blockingDefects.slice(0, 40),
          defect_fingerprint: fingerprint,
          last_build_id: args.buildId,
          terminal_reason: stalled
            ? "the same problem came back after a fix, so Petal stopped instead of repeating itself"
            : "Petal used all of its automatic repair attempts for this request",
          resume_after: null,
        } as never)
        .eq("id", open.id);
      return;
    }

    await supabaseAdmin
      .from("project_turn_completion")
      .update({
        stage: "needs_repair",
        accepted: false,
        outstanding_defects: args.blockingDefects.slice(0, 40),
        defect_fingerprint: fingerprint,
        last_build_id: args.buildId,
        terminal_reason: args.reason ?? null,
        // Let the open tab try first; the server only steps in after this.
        resume_after: new Date(Date.now() + CLIENT_GRACE_MS).toISOString(),
      } as never)
      .eq("id", open.id);
  } catch (e) {
    console.warn("[turn-completion] outcome write failed", (e as Error).message);
  }
}

/**
 * Records still needing work whose client grace window has expired. Used by the
 * resume worker; ordered oldest first so nothing starves.
 */
export async function listResumable(limit = 5): Promise<CompletionRecord[]> {
  try {
    const { data } = await supabaseAdmin
      .from("project_turn_completion")
      .select("*")
      .eq("stage", "needs_repair")
      .lte("resume_after", new Date().toISOString())
      .order("updated_at", { ascending: true })
      .limit(limit);
    return (data ?? []).map((row) => asRecord(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/**
 * Take one autonomous round off the budget. Conditional on the row still being
 * in `needs_repair`, so two workers (or a worker and the tab) can never spend
 * the same attempt twice.
 */
export async function claimResumeAttempt(
  record: CompletionRecord,
): Promise<boolean> {
  if (record.attempts >= record.max_attempts) {
    await supabaseAdmin
      .from("project_turn_completion")
      .update({
        stage: "budget_spent",
        terminal_reason: "Petal used all of its automatic repair attempts for this request",
      } as never)
      .eq("id", record.id);
    return false;
  }
  const { data, error } = await supabaseAdmin
    .from("project_turn_completion")
    .update({
      stage: "repairing",
      attempts: record.attempts + 1,
      resume_after: null,
    } as never)
    .eq("id", record.id)
    .eq("stage", "needs_repair")
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

/** Give up honestly, naming what still fails. */
export async function markBlocked(
  recordId: string,
  reason: string,
): Promise<void> {
  try {
    await supabaseAdmin
      .from("project_turn_completion")
      .update({ stage: "blocked", terminal_reason: reason.slice(0, 500) } as never)
      .eq("id", recordId);
  } catch {
    /* fail open */
  }
}
