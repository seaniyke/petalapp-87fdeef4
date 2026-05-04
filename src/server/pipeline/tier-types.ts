/**
 * Shared types for the extracted pipeline tiers.
 *
 * Each tier helper is a PURE FUNCTION — takes the inputs it needs, returns
 * its outputs + a list of SSE events the orchestrator should enqueue. The
 * orchestrator (`src/routes/api/generate.ts`) keeps the controller, the
 * stream-loop variables, and the overall control flow. Tiers do not
 * perform I/O on the response stream themselves.
 *
 * Why this shape:
 *   - Behavior preservation: events are appended in the same order the
 *     old inline code emitted them. Diffing a turn before/after is trivial.
 *   - Testability: each tier is unit-testable with plain inputs/outputs.
 *   - No hidden state: the orchestrator still owns `nextFiles` and the
 *     pipeline-level outcome flags. Tiers either return updated values
 *     or hint the orchestrator to mutate them (e.g. `requestHandoff`).
 */

import type { StreamEvent, ProjectFile } from "@/server/generate.server";
import type { LocalVerdict } from "@/server/local-verifier";

/** Events the orchestrator should enqueue, in order. */
export type EmitList = StreamEvent[];

export interface LocalVerifyTierOutput {
  /** Final verdict AFTER npm pre-flight has dropped/escalated dep issues. */
  verdict: LocalVerdict;
  /** Paths whose content actually changed this turn (used by later tiers). */
  earlyChangedPaths: string[];
  /** Pre-flight: real packages dropped because the installer will fetch them. */
  preflightDropped: number;
  /** Pre-flight: confirmed-bogus package roots. */
  preflightHallucinated: string[];
  /** SSE events to emit, in order. */
  emit: EmitList;
}

export interface ContinuationTierOutput {
  /** Updated file map after the continuation pass (or unchanged on failure). */
  files: ProjectFile[];
  /** True if the continuation pass had to give up. Used by telemetry only
   *  (the legacy user-facing handoff event has been removed). */
  requestHandoff: boolean;
  emit: EmitList;
}

export interface EsbuildTierOutput {
  verdict: import("@/server/esbuild-verifier.server").EsbuildVerdict;
  emit: EmitList;
}
