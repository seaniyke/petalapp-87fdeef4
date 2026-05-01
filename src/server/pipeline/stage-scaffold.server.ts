/**
 * Staged Pipeline — Stage 2: SCAFFOLD (parallel)
 *
 * STUB — wires the function signature + behavior contract. The actual
 * parallel-per-file generation lands in the next turn once Stage 1's
 * plan output is exercised end-to-end against the existing monolithic
 * fallback.
 *
 * Contract (final):
 *   - Input: a PlannedFile[] from Stage 1 + brief + context summary.
 *   - Behavior: fires N parallel `aiChatCompletions` calls, one per
 *     file, each with forced tool_choice on a single-file write tool
 *     and a tight max_tokens budget (~30% of model ceiling).
 *   - Recovery: per-file `Promise.allSettled` — one failed file does
 *     NOT kill the build; that file gets a retry with smaller scope.
 *   - Output: ProjectFile[] ready for Stage 3 (wire-up + verify).
 *
 * Until the implementation lands, returning `{ ok: false, reason }`
 * forces the orchestrator to fall back to the existing monolithic
 * generation. That keeps the staged pipeline safe to enable in Labs
 * without risking regressions.
 */

import type { PlannedFile } from "./stage-plan.server";
import type { ProjectFile } from "@/server/generate.server";

export interface StageScaffoldResult {
  ok: true;
  files: ProjectFile[];
  /** Per-file outcome for telemetry. */
  outcomes: Array<{ path: string; ok: boolean; reason?: string }>;
}

export interface StageScaffoldFailure {
  ok: false;
  reason: string;
}

export async function runStageScaffold(_args: {
  plan: PlannedFile[];
  brief: string;
}): Promise<StageScaffoldResult | StageScaffoldFailure> {
  // Intentional stub. Returning a failure causes the orchestrator to
  // fall back to the monolithic path. See file header for the full
  // contract this will fulfill in the next turn.
  return { ok: false, reason: "stage_scaffold_not_implemented" };
}
