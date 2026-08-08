/**
 * Grading function for a single golden-app generation result.
 *
 * Each gate is independent and recorded. A run is considered passing only
 * when every applicable gate passes. The verifier and bundle gates use the
 * existing `local-verifier.ts` so we don't duplicate logic.
 */

import { verifyFilesLocal } from "../../local-verifier";
import { deterministicPrd } from "../../prd/prd-deterministic";
import { checkPrdStatically } from "../../prd/prd-acceptance.server";
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
  /** esbuild bundle pass (set by the replay harness). */
  bundlePassed: boolean;
  /**
   * Product acceptance: does the app contain the product the prompt asked
   * for? Derived from the deterministic PRD for the same prompt, so CI
   * catches "compiles fine, useless app" the same way the live gate does.
   */
  productPassed: boolean;
  productFindings?: ReadonlyArray<string>;
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
      productPassed: false,
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

  const prd = deterministicPrd(app.prompt);
  const product = checkPrdStatically(prd, [...generated.files]);
  const productFindings = product.findings
    .filter((f) => f.severity === "blocking")
    .map((f) => `[${f.criterionId}] ${f.message}`);

  return {
    filesEmitted: true,
    verifierPassed: allIssues.length === 0,
    // Set by the replay harness (esbuild parse pass).
    bundlePassed: false,
    productPassed: product.passed,
    productFindings: productFindings.length ? productFindings : undefined,
    expectedFilesPresent,
    issues: allIssues.length > 0 ? allIssues : undefined,
  };
}
