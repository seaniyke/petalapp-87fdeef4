/**
 * Tier 2.6 — TRUE truncation recovery.
 *
 * Re-asks the same model to emit the missing tail bytes when the local
 * verifier flagged any file as truncated / unterminated / brace-imbalanced.
 *
 * Behavior preservation:
 *   - Same trigger condition (any of: truncation, unterminated-string, braces).
 *   - Returned files reflect the continuation pass output.
 *   - When the pass ran but produced zero completed files, we surface
 *     `requestHandoff: true` so the orchestrator can record a "failed"
 *     telemetry outcome for this turn.
 *   - Errors are caught and reported as a "failed" timeline (same as before).
 */

import { runContinuation } from "@/server/stream-continuation.server";
import type { ProjectFile } from "@/server/generate.server";
import type { LocalVerdict } from "@/server/local-verifier";
import type { ContinuationTierOutput } from "./tier-types";

interface RunArgs {
  files: ProjectFile[];
  verdict: LocalVerdict;
  model: string;
}

const TRIGGER_KINDS = new Set(["truncation", "unterminated-string", "braces"]);

export async function runContinuationTier(args: RunArgs): Promise<ContinuationTierOutput> {
  const { files, verdict, model } = args;
  const emit: ContinuationTierOutput["emit"] = [];

  const shouldRun = verdict.issues.some((i) => TRIGGER_KINDS.has(i.kind));
  if (!shouldRun) return { files, requestHandoff: false, emit };

  try {
    const contOut = await runContinuation({
      files,
      issues: verdict.issues,
      model,
    });

    let requestHandoff = false;
    if (contOut.result.completedFiles > 0) {
      console.log(
        `[continuation] completed ${contOut.result.completedFiles}:`,
        contOut.result.notes.join("; "),
      );
      emit.push({
        type: "status",
        message: `Completed ${contOut.result.completedFiles} truncated file${contOut.result.completedFiles === 1 ? "" : "s"}.`,
      });
    } else if (contOut.result.notes.length) {
      console.warn("[continuation] no files completed:", contOut.result.notes.join("; "));
      // Continuation pass ran but couldn't finish — strongest signal we hit
      // the model's output ceiling. Surface the failure so telemetry can
      // record it.
      requestHandoff = true;
    }

    emit.push({
      type: "timeline",
      step: "continuation",
      outcome: contOut.result.completedFiles > 0 ? "fixed" : "failed",
      message:
        contOut.result.completedFiles > 0
          ? `Finished ${contOut.result.completedFiles} truncated file${contOut.result.completedFiles === 1 ? "" : "s"}`
          : "Couldn't finish a truncated file — handing off to autofix",
      count: contOut.result.completedFiles,
      ts: Date.now(),
    });

    return { files: contOut.files, requestHandoff, emit };
  } catch (e) {
    console.warn("[continuation] failed:", e);
    emit.push({
      type: "timeline",
      step: "continuation",
      outcome: "failed",
      message: "Continuation pass errored — falling back to autofix",
      ts: Date.now(),
    });
    // On thrown error, do NOT flag requestHandoff — keep the original
    // contract so error-path telemetry isn't double-counted.
    return { files, requestHandoff: false, emit };
  }
}
