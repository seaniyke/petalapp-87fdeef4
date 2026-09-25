/**
 * Authoritative turn reconciliation.
 *
 * The SSE `result` frame is a TRANSPORT artefact, not evidence of success.
 * When a phone locks, switches radios, or a proxy closes the socket, the
 * frame is lost even though the server already committed files, advanced
 * `projects.revision`, and marked the turn `succeeded`. Treating a missing
 * frame as failure produced the "Kimble ran out of time before saving
 * changes" card for builds that had, in fact, fully succeeded.
 *
 * So before any failure is ever shown, the client asks the database what
 * actually happened. The tables here are the same ones the server writes
 * inside its own transactions — no new state, no new source of truth.
 */

import { supabase } from "@/integrations/supabase/client";

export type ReconciledState =
  | "SUCCEEDED"
  | "BUILDING"
  | "RUNNING"
  | "FAILED"
  | "ABORTED"
  | "WAITING_FOR_USER"
  | "UNKNOWN";

export type ReconciledTurn = {
  state: ReconciledState;
  /** Server-recorded failure text. Never invented client-side. */
  errorMessage: string | null;
  committedRevision: number | null;
  projectRevision: number | null;
  buildId: string | null;
  buildStatus: string | null;
  creditsCharged: number | null;
  /** True when the database proves this turn wrote code. */
  committed: boolean;
};

const UNKNOWN: ReconciledTurn = {
  state: "UNKNOWN",
  errorMessage: null,
  committedRevision: null,
  projectRevision: null,
  buildId: null,
  buildStatus: null,
  creditsCharged: null,
  committed: false,
};

/**
 * Ask the database for the real outcome of one turn. Never throws — an
 * unreachable network must not turn into a false failure either, so it
 * degrades to UNKNOWN and the caller keeps its current (waiting) state.
 */
export async function reconcileAuthoritativeTurn(
  projectId: string | null | undefined,
  turnId: string | null | undefined,
): Promise<ReconciledTurn> {
  if (!turnId) return UNKNOWN;
  try {
    const [turnRes, projectRes] = await Promise.all([
      supabase
        .from("turns")
        .select("status, committed_revision, error_message, credits_charged")
        .eq("id", turnId)
        .maybeSingle(),
      projectId
        ? supabase
            .from("projects")
            .select("revision, latest_build_id")
            .eq("id", projectId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
    ]);

    const turn = turnRes.data as
      | {
          status: string;
          committed_revision: number | null;
          error_message: string | null;
          credits_charged: number | null;
        }
      | null;
    if (!turn) return UNKNOWN;

    const project = projectRes.data as
      | { revision: number | null; latest_build_id: string | null }
      | null;

    let buildStatus: string | null = null;
    const buildId = project?.latest_build_id ?? null;
    if (buildId) {
      const { data: build } = await supabase
        .from("project_builds")
        .select("status, project_revision")
        .eq("id", buildId)
        .maybeSingle();
      const row = build as { status: string; project_revision: number | null } | null;
      // Only a build of the revision this turn committed says anything about
      // this turn. A stale build must never colour the outcome.
      if (
        row &&
        (turn.committed_revision == null ||
          row.project_revision == null ||
          row.project_revision >= turn.committed_revision)
      ) {
        buildStatus = row.status;
      }
    }

    const base: ReconciledTurn = {
      state: "UNKNOWN",
      errorMessage: turn.error_message ?? null,
      committedRevision: turn.committed_revision ?? null,
      projectRevision: project?.revision ?? null,
      buildId,
      buildStatus,
      creditsCharged: turn.credits_charged ?? null,
      committed: typeof turn.committed_revision === "number",
    };

    switch (turn.status) {
      case "succeeded":
        return {
          ...base,
          state:
            buildStatus === "pending" || buildStatus === "building"
              ? "BUILDING"
              : "SUCCEEDED",
        };
      case "running":
      case "completing":
        return { ...base, state: "RUNNING" };
      case "awaiting_credits":
        return { ...base, state: "WAITING_FOR_USER" };
      case "aborted":
      case "cancelled":
        return { ...base, state: "ABORTED" };
      case "failed":
        return { ...base, state: "FAILED" };
      default:
        return base;
    }
  } catch {
    return UNKNOWN;
  }
}

/** True when the outcome means "do not show a failure card". */
export function isNonFailure(state: ReconciledState): boolean {
  return (
    state === "SUCCEEDED" ||
    state === "BUILDING" ||
    state === "RUNNING" ||
    state === "WAITING_FOR_USER"
  );
}
