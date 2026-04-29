/**
 * Tier 2.8 — render-risk linter.
 *
 * Wraps the deterministic linter for the orchestrator. Pure function:
 * takes files + changed paths, returns issues + the SSE timeline event
 * the orchestrator should enqueue.
 *
 * Behavior contract: SOFT-warn. The issues are appended to the autofix
 * queue (so the post-stream autofix model fixes them in the same round)
 * but a stubborn render-risk does NOT block shipping the turn — a false
 * positive must never wedge a clean build.
 */

import { lintRenderRisks } from "@/server/render-risk-linter";
import type { LocalIssue } from "@/server/local-verifier";
import type { ProjectFile, StreamEvent } from "@/server/generate.server";

interface RunArgs {
  files: ProjectFile[];
  earlyChangedPaths: string[];
}

export interface RenderRiskTierOutput {
  issues: LocalIssue[];
  emit: StreamEvent[];
}

export function runRenderRiskTier(args: RunArgs): RenderRiskTierOutput {
  const { files, earlyChangedPaths } = args;
  const issues = lintRenderRisks(files, earlyChangedPaths);

  if (issues.length > 0) {
    console.warn(
      `[render-risk] ${issues.length} issue(s):`,
      issues.map((i) => `${i.path}: ${i.detail}`).join("; "),
    );
  }

  const emit: StreamEvent[] = [
    {
      type: "timeline",
      step: "render_risk",
      outcome: issues.length === 0 ? "ok" : "failed",
      message:
        issues.length === 0
          ? `Render-risk check clean on ${earlyChangedPaths.length} file${earlyChangedPaths.length === 1 ? "" : "s"}`
          : `Found ${issues.length} render-risk issue${issues.length === 1 ? "" : "s"}`,
      count: issues.length === 0 ? earlyChangedPaths.length : issues.length,
      ts: Date.now(),
    },
  ];

  return { issues, emit };
}
