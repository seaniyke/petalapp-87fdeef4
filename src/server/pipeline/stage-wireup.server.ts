/**
 * Staged Pipeline — Stage 3: WIRE-UP
 *
 * Takes the parallel-scaffold output and runs it through the same
 * deterministic verifiers the monolithic path uses, so behavior at the
 * file level is identical regardless of which pipeline produced it:
 *
 *   1. Local verifier (parse + import + named-export checks).
 *   2. Esbuild verifier (real parser; catches syntax the regex pass misses).
 *
 * If either verifier surfaces hard issues we cannot mechanically resolve
 * here, we hand control back to the orchestrator with `ok: false` and let
 * it fall back to the existing autofix/continuation path. We do not
 * duplicate the autofix logic — it lives in the existing tier helpers and
 * is already battle-tested on the monolithic path.
 *
 * Why no continuation pass here yet:
 *   - Stage 2 already retries any truncated file with a smaller cap.
 *   - The continuation tier requires the original tool-stream context
 *     which we don't have in the staged pipeline. We'd rather surface
 *     the failure honestly than fabricate a fake continuation.
 */

import { verifyFilesLocal } from "@/server/local-verifier";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import type { ProjectFile } from "@/server/generate.server";

export interface StageWireupResult {
  ok: true;
  files: ProjectFile[];
  summary: string;
  /** Verifier diagnostics, surfaced for telemetry but already non-fatal. */
  notes: string[];
}

export interface StageWireupFailure {
  ok: false;
  reason: string;
  /** Verifier issues that blocked the wire-up — for orchestrator logs. */
  blockingIssues: string[];
}

export async function runStageWireup(args: {
  files: ProjectFile[];
  brief: string;
}): Promise<StageWireupResult | StageWireupFailure> {
  const allPaths = args.files.map((f) => f.path);
  const notes: string[] = [];

  // 1. Local verifier — parse + imports + exports.
  const localVerdict = verifyFilesLocal(args.files, allPaths);
  if (!localVerdict.ok) {
    const fatal = localVerdict.issues.filter(
      (i) => i.kind === "truncation" || i.kind === "unterminated-string" || i.kind === "braces",
    );
    if (fatal.length > 0) {
      return {
        ok: false,
        reason: "local_verifier_fatal",
        blockingIssues: fatal.map((i) => `${i.path}: ${i.kind} — ${i.detail ?? ""}`).slice(0, 8),
      };
    }
    // Non-fatal issues (missing imports, missing exports) are recoverable
    // by the orchestrator's existing autofix tier — we just note them.
    notes.push(
      `local-verifier: ${localVerdict.issues.length} non-fatal issue(s) deferred to autofix`,
    );
  }

  // 2. Esbuild verifier — real parser. Fatal here means the file is
  // syntactically broken in a way local-verifier missed.
  try {
    const esbuildVerdict = await verifyFilesEsbuild(args.files, allPaths);
    if (!esbuildVerdict.ok) {
      return {
        ok: false,
        reason: "esbuild_parse_failed",
        blockingIssues: esbuildVerdict.issues
          .map((i) => `${i.path}:${i.line}:${i.column} — ${i.message}`)
          .slice(0, 8),
      };
    }
  } catch (e) {
    notes.push(`esbuild-verifier threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: true,
    files: args.files,
    summary: `Built ${args.files.length} file${args.files.length === 1 ? "" : "s"} for: ${args.brief.slice(0, 80)}`,
    notes,
  };
}
