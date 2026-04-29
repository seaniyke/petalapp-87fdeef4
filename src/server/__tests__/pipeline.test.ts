/**
 * Pipeline regression harness — Phase 6.
 *
 * Plain-Node assertions, runnable with `bun src/server/__tests__/pipeline.test.ts`.
 * No vitest dependency yet — kept self-contained so adding it later is a
 * pure config change rather than a test-rewrite.
 *
 * What this harness covers TODAY:
 *  - local-verifier verdict for clean / truncated / hallucinated-package fixtures
 *  - file-budget verdict for oversize / soft-warn / clean fixtures
 *
 * What it INTENTIONALLY does not cover yet:
 *  - The full /api/generate route (too much mocking — server functions,
 *    Supabase, AI provider, credit ledger). Would need integration tests
 *    with a fake AI provider; out of scope for Phase 6.
 *  - The esbuild-wasm verifier (cold-start cost in CI; covered by manual
 *    smoke tests for now).
 *
 * Run: `bun src/server/__tests__/pipeline.test.ts`
 * Exit 0 = all pass, exit 1 = at least one fixture regressed.
 */
import { verifyFilesLocal } from "../local-verifier";
import { checkFileBudgets } from "../file-budget.server";
import {
  applyNpmPreflight,
  _resetNpmExistenceCache,
} from "../npm-existence.server";
import { FIXTURES } from "./pipeline.fixtures";

type Result = { name: string; ok: boolean; reason?: string };

function runFixture(fixture: (typeof FIXTURES)[number]): Result {
  const verdict = verifyFilesLocal(fixture.files, fixture.changedPaths);

  // Verifier check: every expected substring must appear in at least one issue.
  for (const needle of fixture.expectIssueIncludes) {
    const hit = verdict.issues.some(
      (i) => i.detail.includes(needle) || i.path.includes(needle),
    );
    if (!hit) {
      return {
        name: fixture.name,
        ok: false,
        reason: `expected an issue mentioning "${needle}" but got: ${
          verdict.issues.length
            ? verdict.issues.map((i) => `[${i.kind}] ${i.path}: ${i.detail}`).join(" | ")
            : "(no issues)"
        }`,
      };
    }
  }

  // If the fixture expected NO substrings, still flag if the verifier
  // produced unexpected issues on a clean fixture (only when the fixture
  // is named "clean" — the slip-through fixtures intentionally produce no
  // issues yet).
  if (fixture.expectIssueIncludes.length === 0 && fixture.name.startsWith("clean")) {
    if (!verdict.ok) {
      return {
        name: fixture.name,
        ok: false,
        reason: `clean fixture expected ok=true but verifier flagged: ${verdict.issues
          .map((i) => `[${i.kind}] ${i.path}`)
          .join(", ")}`,
      };
    }
  }

  // Budget check (when the fixture pins it).
  if (fixture.expectBudget) {
    const budget = checkFileBudgets(fixture.files, fixture.changedPaths);
    if (budget.rejections.length !== fixture.expectBudget.rejections) {
      return {
        name: fixture.name,
        ok: false,
        reason: `expected ${fixture.expectBudget.rejections} budget rejection(s), got ${budget.rejections.length} (${budget.rejections.map((r) => r.path).join(", ")})`,
      };
    }
    if (budget.warnings.length !== fixture.expectBudget.warnings) {
      return {
        name: fixture.name,
        ok: false,
        reason: `expected ${fixture.expectBudget.warnings} budget warning(s), got ${budget.warnings.length} (${budget.warnings.map((w) => w.path).join(", ")})`,
      };
    }
  }

  return { name: fixture.name, ok: true };
}

function main() {
  const results = FIXTURES.map(runFixture);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.name}`);
    } else {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.reason}`);
    }
  }
  console.log(`\n${passed}/${results.length} fixtures passed`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} fixture(s) regressed.`);
    process.exit(1);
  }
}

main();
