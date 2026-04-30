/**
 * Grading function for a single golden-app generation result.
 *
 * Each gate is independent and recorded. A run is considered passing only
 * when every applicable gate passes. The verifier and bundle gates use the
 * existing `local-verifier.ts` so we don't duplicate logic.
 */

import { verifyFilesLocal } from "../../local-verifier";
import { lintRenderRisks } from "../../render-risk-linter";
import { lintRlsSanity } from "../../rls-sanity-linter";
import type { GoldenAppPrompt } from "./prompts";

export interface GeneratedApp {
  files: ReadonlyArray<{ path: string; content: string }>;
  changedPaths: ReadonlyArray<string>;
}

export interface GradeResult {
  filesEmitted: boolean;
  verifierPassed: boolean;
  /** esbuild bundle (run separately — wired in Phase 2). */
  bundlePassed: boolean;
  /** tsc --noEmit on changed files (Phase 2). */
  typecheckPassed: boolean;
  expectedFilesPresent?: boolean;
  notes?: string;
  issues?: ReadonlyArray<string>;
}

export function grade(app: GoldenAppPrompt, generated: GeneratedApp | null): GradeResult {
  if (!generated || generated.files.length === 0) {
    return {
      filesEmitted: false,
      verifierPassed: false,
      bundlePassed: false,
      typecheckPassed: false,
      notes: "generator returned no files",
    };
  }

  const expectedFilesPresent = app.expectFiles.every((needle) =>
    generated.files.some((f) => f.path.includes(needle)),
  );

  const verdict = verifyFilesLocal([...generated.files], [...generated.changedPaths]);
  const renderIssues = lintRenderRisks([...generated.files], [...generated.changedPaths]);
  const rlsIssues = lintRlsSanity([...generated.files], [...generated.changedPaths]);
  const allIssues = [
    ...verdict.issues.map((i) => `[${i.kind}] ${i.path}: ${i.detail}`),
    ...renderIssues.map((i) => `[${i.kind}] ${i.path}: ${i.detail}`),
    ...rlsIssues.map((i) => `[${i.kind}] ${i.path}: ${i.detail}`),
  ];

  return {
    filesEmitted: true,
    verifierPassed: allIssues.length === 0,
    // Wired in Phase 2.
    bundlePassed: false,
    typecheckPassed: false,
    expectedFilesPresent,
    issues: allIssues.length > 0 ? allIssues : undefined,
  };
}
