/**
 * Staged Pipeline — Stage 3: WIRE-UP
 *
 * STUB — wires the function signature + behavior contract. The actual
 * implementation reuses the existing verifier/continuation machinery
 * (local-verifier, tier-continuation, esbuild-verifier) and adds a
 * narrow "fix imports + register routes" pass between Stage 2 output
 * and the final write.
 *
 * Contract (final):
 *   - Input: ProjectFile[] from Stage 2.
 *   - Behavior:
 *       1. Run local-verifier on the union of files.
 *       2. If any file is truncated → tier-continuation (already exists).
 *       3. Patch missing routes / wire imports referenced in plan deps.
 *       4. Run esbuild-verifier; surface unrecoverable failures up.
 *   - Output: final ProjectFile[] + summary text the chat shows.
 */

import type { ProjectFile } from "@/server/generate.server";

export interface StageWireupResult {
  ok: true;
  files: ProjectFile[];
  summary: string;
}

export interface StageWireupFailure {
  ok: false;
  reason: string;
}

export async function runStageWireup(_args: {
  files: ProjectFile[];
  brief: string;
}): Promise<StageWireupResult | StageWireupFailure> {
  // Intentional stub. Stage 2 currently always returns failure, so
  // Stage 3 is unreachable; this keeps the type surface stable for
  // when Stage 2 lands.
  return { ok: false, reason: "stage_wireup_not_implemented" };
}
