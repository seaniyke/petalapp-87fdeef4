/**
 * Tier 2.9 — RLS sanity linter (Phase 5b).
 *
 * Wraps the deterministic RLS linter for the orchestrator. Same SOFT-warn
 * contract as Tier 2.8: issues are appended to the autofix queue (so the
 * post-stream autofix model fixes them when the gate is already open) but
 * a stubborn RLS-sanity finding does NOT independently block shipping —
 * a false positive must never wedge a clean build.
 */

import { lintRlsSanity } from "@/server/rls-sanity-linter";
import type { LocalIssue } from "@/server/local-verifier";
import type { ProjectFile, StreamEvent } from "@/server/generate.server";

interface RunArgs {
  files: ProjectFile[];
  earlyChangedPaths: string[];
}

export interface RlsSanityTierOutput {
  issues: LocalIssue[];
  emit: StreamEvent[];
}

export function runRlsSanityTier(args: RunArgs): RlsSanityTierOutput {
  const { files, earlyChangedPaths } = args;
  const issues = lintRlsSanity(files, earlyChangedPaths);

  if (issues.length > 0) {
    console.warn(
      `[rls-sanity] ${issues.length} issue(s):`,
      issues.map((i) => `${i.path}: ${i.detail}`).join("; "),
    );
  }

  const emit: StreamEvent[] = [
    {
      type: "timeline",
      step: "rls_sanity",
      outcome: issues.length === 0 ? "ok" : "failed",
      message:
        issues.length === 0
          ? `RLS sanity check clean on ${earlyChangedPaths.length} file${earlyChangedPaths.length === 1 ? "" : "s"}`
          : `Found ${issues.length} RLS-sanity issue${issues.length === 1 ? "" : "s"}`,
      count: issues.length === 0 ? earlyChangedPaths.length : issues.length,
      ts: Date.now(),
    },
  ];

  return { issues, emit };
}
