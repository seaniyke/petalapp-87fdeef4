/**
 * Tier 2.5 + 2.45 — local verifier + npm pre-flight.
 *
 * These two run together because pre-flight rewrites the verdict's issue
 * list (drops false-positive `missing-dep` for real packages, escalates
 * hallucinated ones). Splitting them would force the orchestrator to
 * juggle a verdict-mid-mutation, which defeats the point of extraction.
 *
 * Behavior preservation:
 *   - earlyChangedPaths is computed exactly as the inline version did
 *     (write_project → diff against priorByPath; otherwise use op paths).
 *   - Pre-flight failure is swallowed (warns + keeps original verdict).
 *   - Emits two SSE events when warranted: status (only on !ok),
 *     timeline (always), plus an extra npm_preflight timeline iff
 *     pre-flight changed something.
 */

import { verifyFilesLocal } from "@/server/local-verifier";
import { applyNpmPreflight } from "@/server/npm-existence.server";
import type { ProjectFile } from "@/server/generate.server";
import type { FileOp } from "@/server/generate.server";
import type { LocalVerifyTierOutput } from "./tier-types";

interface RunArgs {
  /** Files in their post-stream-autofix state. */
  nextFiles: ProjectFile[];
  /** Files as they were at the start of the turn (for diffing). */
  currentFiles: ProjectFile[];
  /** Tool name the model called (`write_project` vs `patch_files`). */
  toolName: string | null;
  /** Parsed ops (only populated for `patch_files` turns). */
  parsedOps: FileOp[] | undefined;
}

export async function runLocalVerifyTier(args: RunArgs): Promise<LocalVerifyTierOutput> {
  const { nextFiles, currentFiles, toolName, parsedOps } = args;

  const priorByPath = new Map(currentFiles.map((f) => [f.path, f.content]));
  const earlyChangedPaths =
    toolName === "write_project"
      ? nextFiles.filter((f) => priorByPath.get(f.path) !== f.content).map((f) => f.path)
      : (parsedOps ?? []).map((o) => o.path);

  const verdict = verifyFilesLocal(nextFiles, earlyChangedPaths);

  // Tier 2.45 — npm pre-flight (mutates verdict.issues in place via reassignment).
  let preflightDropped = 0;
  let preflightHallucinated: string[] = [];
  let realButMissing: string[] = [];
  try {
    const pre = await applyNpmPreflight(verdict.issues);
    preflightDropped = pre.realButMissing.length;
    preflightHallucinated = pre.hallucinated;
    realButMissing = pre.realButMissing;
    verdict.issues = pre.issues;
    verdict.ok = pre.issues.length === 0;
    if (preflightDropped > 0) {
      console.log(
        `[npm-preflight] dropped ${preflightDropped} real-but-missing dep issue(s):`,
        pre.realButMissing.join(", "),
      );
    }
    if (pre.hallucinated.length > 0) {
      console.warn(
        `[npm-preflight] confirmed ${pre.hallucinated.length} hallucinated package(s):`,
        pre.hallucinated.join(", "),
      );
    }
  } catch (e) {
    console.warn("[npm-preflight] errored, skipping:", e);
  }

  if (!verdict.ok) {
    console.warn(
      `[local-verifier] ${verdict.issues.length} issue(s):`,
      verdict.issues.map((i) => `${i.path} (${i.kind}): ${i.detail}`).join("; "),
    );
  }

  const emit: LocalVerifyTierOutput["emit"] = [];

  // Honest message — break the count into structural vs unknown imports so
  // a single missing-dep doesn't read as a "structural issue". Truncation +
  // braces + JSX + parse + undefined are real structural problems; the rest
  // (missing-dep, missing-sibling, missing-export, oversize, render-risk,
  // rls-sanity, lazy-export) are softer signals.
  const STRUCTURAL = new Set(["truncation", "braces", "jsx", "parse", "undefined", "unterminated-string"]);
  const structuralCount = verdict.issues.filter((i) => STRUCTURAL.has(i.kind)).length;
  const importCount = verdict.issues.filter((i) => i.kind === "missing-dep" || i.kind === "missing-sibling").length;
  const otherCount = verdict.issues.length - structuralCount - importCount;

  if (!verdict.ok) {
    const parts: string[] = [];
    if (structuralCount > 0)
      parts.push(`${structuralCount} structural`);
    if (importCount > 0)
      parts.push(`${importCount} unresolved import${importCount === 1 ? "" : "s"}`);
    if (otherCount > 0)
      parts.push(`${otherCount} soft warning${otherCount === 1 ? "" : "s"}`);
    emit.push({
      type: "status",
      message: `Detected ${parts.join(" + ")} — repairing…`,
    });
  }

  emit.push({
    type: "timeline",
    step: "local_verifier",
    outcome: verdict.ok ? "ok" : "failed",
    message: verdict.ok
      ? `Verified ${earlyChangedPaths.length} changed file${earlyChangedPaths.length === 1 ? "" : "s"} — looks healthy`
      : (() => {
          const parts: string[] = [];
          if (structuralCount > 0)
            parts.push(`${structuralCount} structural`);
          if (importCount > 0)
            parts.push(`${importCount} import${importCount === 1 ? "" : "s"}`);
          if (otherCount > 0) parts.push(`${otherCount} other`);
          return `Found ${parts.join(", ")}`;
        })(),
    count: verdict.ok ? earlyChangedPaths.length : verdict.issues.length,
    ts: Date.now(),
  });

  if (preflightDropped > 0 || preflightHallucinated.length > 0) {
    emit.push({
      type: "timeline",
      step: "npm_preflight",
      outcome: preflightHallucinated.length > 0 ? "failed" : "fixed",
      message:
        preflightHallucinated.length > 0
          ? `Confirmed ${preflightHallucinated.length} hallucinated package${preflightHallucinated.length === 1 ? "" : "s"}: ${preflightHallucinated.slice(0, 3).join(", ")}`
          : `Cleared ${preflightDropped} real package${preflightDropped === 1 ? "" : "s"} the installer will fetch`,
      count: preflightHallucinated.length || preflightDropped,
      ts: Date.now(),
    });
  }

  return {
    verdict,
    earlyChangedPaths,
    preflightDropped,
    preflightHallucinated,
    realButMissing,
    emit,
  };
}
