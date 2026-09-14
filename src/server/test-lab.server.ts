/**
 * Test Lab executor — phase 5.
 *
 * Everything the Test Lab needed already existed as parts: a planner
 * (`test-plan`), a steerable browser (`browse-client`), a judge and recorder
 * (`test-results`), spend rules (`test-cost`). Nothing in the live pipeline
 * ever ran them. This module is the missing conductor: it takes a deployed
 * build, works out which checks are worth running, drives the real browser,
 * judges each case against real evidence, and records the run.
 *
 * Two shapes of run:
 *   - first build  — the whole prioritized plan, trimmed to budget.
 *   - an edit      — the must-work checks plus the pages the edit touched.
 *                    Everything else is recorded as *skipped*, never passed.
 *
 * Fails open everywhere: a Test Lab problem must never turn a healthy deploy
 * into a failed one. When it cannot run, it says so and records nothing.
 */
import type { ProjectFile } from "@/server/generate.server";
import {
  buildTestPlan,
  rank,
  selectCases,
  type TestCase,
  type TestPlan,
  type TestBudget,
} from "@/server/test-plan.server";
import {
  isBrowseConfigured,
  runBrowseSession,
  type BrowseReport,
} from "@/server/browse-client.server";
import {
  judgeCase,
  skippedResult,
  blockedResult,
  startTestRun,
  recordCase,
  finishTestRun,
  tallyResults,
  type CaseResult,
  type RunStatus,
  type RunTotals,
} from "@/server/test-results.server";
import { TEST_LIMITS, shouldOpenBrowser, describeSpend } from "@/server/test-cost.server";
import type { VerifyPlan } from "@/server/verify-plan.server";

export interface TestLabResult {
  ran: boolean;
  reason?: string;
  runId?: string | null;
  status?: RunStatus;
  totals?: RunTotals;
  results: CaseResult[];
  spend?: string;
}

const NOT_RUN = (reason: string): TestLabResult => ({ ran: false, reason, results: [] });

/** Paths that can only change how something looks. */
const COSMETIC = /\.(css|scss)$|tailwind|theme|styles?\b/i;
/** Paths that can change data, auth or server behaviour. */
const BACKEND = /(^|\/)(server|api|integrations|supabase|migrations|lib\/(auth|db))/i;

export function isCosmeticEdit(changedPaths: string[]): boolean {
  if (!changedPaths.length) return false;
  return !changedPaths.some((p) => BACKEND.test(p)) &&
    changedPaths.every((p) => COSMETIC.test(p) || /\.(tsx|jsx)$/.test(p));
}

const tokensOf = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

/** Route a case visits first, e.g. "/pricing". */
function caseRoute(testCase: TestCase): string | null {
  const goto = testCase.actions.find((a) => a.action === "goto") as
    | { action: "goto"; path?: string }
    | undefined;
  return goto?.path ?? null;
}

/**
 * Risk-based scoping for an edit. Must-work checks always run — a fix must not
 * quietly break the front door. Beyond that we only re-run checks whose page
 * the edit plausibly touched, and a purely cosmetic edit does not pay for
 * auth or journey checks.
 */
export function scopeCasesToEdit(
  cases: TestCase[],
  changedPaths: string[],
): { run: TestCase[]; skipped: Array<{ case: TestCase; reason: string }> } {
  if (!changedPaths.length) return { run: cases, skipped: [] };
  const cosmetic = isCosmeticEdit(changedPaths);
  const pathTokens = new Set(changedPaths.flatMap(tokensOf));

  const run: TestCase[] = [];
  const skipped: Array<{ case: TestCase; reason: string }> = [];

  for (const testCase of cases) {
    if (testCase.priority === "P0") {
      if (cosmetic && (testCase.category === "auth" || testCase.category === "journey")) {
        skipped.push({ case: testCase, reason: "this change only affects how the page looks" });
        continue;
      }
      run.push(testCase);
      continue;
    }
    const route = caseRoute(testCase);
    const touched = route
      ? tokensOf(route).some((t) => pathTokens.has(t)) || route === "/"
      : false;
    if (!touched) {
      skipped.push({ case: testCase, reason: "this change did not touch that page" });
      continue;
    }
    if (cosmetic && (testCase.category === "auth" || testCase.category === "journey")) {
      skipped.push({ case: testCase, reason: "this change only affects how the page looks" });
      continue;
    }
    run.push(testCase);
  }

  return { run, skipped };
}

/** Drive one case in a real browser and judge it against what came back. */
async function runCase(args: {
  projectId: string;
  baseUrl: string;
  testCase: TestCase;
  plan: TestPlan;
  signal?: AbortSignal;
}): Promise<CaseResult> {
  let report: BrowseReport;
  try {
    report = await runBrowseSession({
      projectId: args.projectId,
      baseUrl: args.baseUrl,
      actions: args.testCase.actions,
      signal: args.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return blockedResult(args.testCase, `Petal could not open the app to check this: ${message}`);
  }
  return judgeCase(args.testCase, report, args.plan.identity ?? null);
}

export async function runTestLab(args: {
  projectId: string;
  buildId: string;
  turnId?: string | null;
  baseUrl: string;
  files: ProjectFile[];
  verify?: VerifyPlan | null;
  /** Paths this turn changed. Empty/absent means "first build — test it all". */
  changedPaths?: string[];
  budget?: TestBudget;
  attempt?: number;
  signal?: AbortSignal;
}): Promise<TestLabResult> {
  if (!isBrowseConfigured()) return NOT_RUN("browser testing is not configured");
  if (!args.baseUrl) return NOT_RUN("no deployed URL to test");

  let plan: TestPlan;
  try {
    plan = buildTestPlan({ projectId: args.projectId, files: args.files, verify: args.verify });
  } catch (err) {
    return NOT_RUN(`could not work out what to check: ${String(err)}`);
  }
  if (!plan.cases.length) return NOT_RUN("nothing to check");

  const budget: TestBudget = args.budget ?? "tight";
  const byBudget = selectCases(plan, budget);
  const scoped = scopeCasesToEdit(rank(byBudget.run), args.changedPaths ?? []);

  const results: CaseResult[] = [];
  for (const dropped of byBudget.skipped) {
    results.push(skippedResult(dropped, "left out to keep this turn quick"));
  }
  for (const dropped of scoped.skipped) {
    results.push(skippedResult(dropped.case, dropped.reason));
  }

  const runId = await startTestRun({
    projectId: args.projectId,
    buildId: args.buildId,
    turnId: args.turnId ?? null,
    budget,
    baseUrl: args.baseUrl,
  });

  const startedAt = Date.now();
  let sessionsUsed = 0;
  let screenshots = 0;

  for (const testCase of scoped.run) {
    const outOfTime = Date.now() - startedAt >= TEST_LIMITS.maxRunMs;
    const decision = shouldOpenBrowser({
      priority: testCase.priority,
      shipped: true,
      sessionsUsed,
    });
    if (outOfTime || !decision.run) {
      results.push(
        skippedResult(testCase, outOfTime ? "the checking time for this turn ran out" : decision.reason),
      );
      continue;
    }
    sessionsUsed += 1;
    const result = await runCase({
      projectId: args.projectId,
      baseUrl: args.baseUrl,
      testCase,
      plan,
      signal: args.signal,
    });
    screenshots += result.images.length;
    results.push(result);
    if (runId) {
      await recordCase({
        runId,
        projectId: args.projectId,
        attempt: (args.attempt ?? 0) + 1,
        result,
      });
    }
  }

  // Record the skipped cases too — a check that did not run must be visible as
  // "not checked", never absent (which reads as fine).
  if (runId) {
    for (const result of results.filter((r) => r.status === "skipped")) {
      await recordCase({ runId, projectId: args.projectId, attempt: (args.attempt ?? 0) + 1, result });
    }
  }

  const totals = tallyResults(results);
  const status = runId
    ? await finishTestRun({ runId, results })
    : (totals.failed > 0 ? "failed" : "passed");
  const spend = describeSpend({ sessions: sessionsUsed, screenshots, aiReviews: 0, budget });
  console.info(`[test-lab] ${args.buildId} ${status} — ${spend}`);

  return { ran: true, runId, status, totals, results, spend };
}
