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

/**
 * Phase 3 — npm pre-flight. Drive `applyNpmPreflight` with a fake fetch
 * so the test stays offline + deterministic. Two cases:
 *   a) hallucinated  → registry returns 404 → issue is KEPT and escalated.
 *   b) real-but-missing → registry returns 200 → issue is DROPPED (the
 *      installer will add the dep).
 */
async function runNpmPreflightCases(): Promise<Result[]> {
  const out: Result[] = [];

  // Build a verifier verdict that contains a missing-dep for a fake package.
  const filesA = [
    { path: "package.json", content: `{"name":"t","dependencies":{"react":"19"}}` },
    { path: "src/App.tsx", content: `import x from "react-cooler-toast-9001";\nexport default function App() { return <div>{x as any}</div>; }\n` },
  ];
  const verdictA = verifyFilesLocal(filesA, ["src/App.tsx"]);

  _resetNpmExistenceCache();
  const fakeFetch404: typeof fetch = async () =>
    new Response(null, { status: 404 }) as unknown as Response;
  const preA = await applyNpmPreflight(verdictA.issues, { fetchImpl: fakeFetch404 });
  const escalated = preA.issues.find(
    (i) => i.kind === "missing-dep" && i.detail.includes("hallucinated"),
  );
  out.push(
    escalated && preA.hallucinated.includes("react-cooler-toast-9001")
      ? { name: "npm preflight — 404 → keep + escalate", ok: true }
      : {
          name: "npm preflight — 404 → keep + escalate",
          ok: false,
          reason: `expected hallucinated detail for react-cooler-toast-9001; got ${JSON.stringify(preA)}`,
        },
  );

  // Real package: same shape, different fake fetch returning 200.
  const filesB = [
    { path: "package.json", content: `{"name":"t","dependencies":{"react":"19"}}` },
    { path: "src/App.tsx", content: `import { format } from "date-fns";\nexport default function App() { return <div>{format(new Date(), "P")}</div>; }\n` },
  ];
  const verdictB = verifyFilesLocal(filesB, ["src/App.tsx"]);
  // local-verifier emits a missing-dep for date-fns since pkg.json doesn't list it
  // (NEVER_PROBE includes date-fns, so we use an unlisted-but-real package instead).
  const filesC = [
    { path: "package.json", content: `{"name":"t","dependencies":{"react":"19"}}` },
    { path: "src/App.tsx", content: `import nanoid from "nanoid";\nexport default function App() { return <div>{nanoid()}</div>; }\n` },
  ];
  const verdictC = verifyFilesLocal(filesC, ["src/App.tsx"]);

  _resetNpmExistenceCache();
  const fakeFetch200: typeof fetch = async () =>
    new Response(null, { status: 200 }) as unknown as Response;
  const preC = await applyNpmPreflight(verdictC.issues, { fetchImpl: fakeFetch200 });
  const stillFlagged = preC.issues.some(
    (i) => i.kind === "missing-dep" && i.detail.includes("nanoid"),
  );
  out.push(
    !stillFlagged && preC.realButMissing.includes("nanoid")
      ? { name: "npm preflight — 200 → drop (installer handles it)", ok: true }
      : {
          name: "npm preflight — 200 → drop (installer handles it)",
          ok: false,
          reason: `expected nanoid issue dropped; got ${JSON.stringify(preC)}`,
        },
  );

  // Silence unused-var lint for verdictB (kept to mirror call shape).
  void verdictB;

  return out;
}

async function main() {
  const results: Result[] = FIXTURES.map(runFixture);
  results.push(...(await runNpmPreflightCases()));

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
