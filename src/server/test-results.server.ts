/**
 * Test Lab evidence — what was checked, what happened, and the proof.
 *
 * Two halves, deliberately separated:
 *
 *   1. `judgeCase()` is pure. Given a test case and the browser report it
 *      produced, it decides passed / failed / blocked and extracts the
 *      evidence. No IO, so the rules are unit-testable and identical whether
 *      the caller is the build pipeline, the agent loop, or a replay.
 *
 *   2. The recorder writes runs and cases to `project_test_runs` /
 *      `project_test_cases` and uploads screenshots to private storage.
 *      Every write fails open: losing bookkeeping must never fail a build.
 *
 * The status vocabulary matters. `blocked` means "we could not actually test
 * this" — the browser was unavailable, the deployment was unreachable, a
 * credential was missing. It is never folded into `passed`, and a run with
 * blocked P0 cases is not a run that proved anything.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BrowseReport } from "@/server/browse-client.server";
import type { TestCase, TestPriority } from "@/server/test-plan.server";
import { redactAll, redactSecrets, redactWithIdentity } from "./test-safety.server";

export type TestStatus = "passed" | "failed" | "blocked" | "skipped";
export type RunStatus = "running" | "passed" | "failed" | "blocked";

export const EVIDENCE_BUCKET = "test-evidence";

export interface CaseEvidence {
  /** Storage paths of screenshots captured during the case. */
  screenshots: string[];
  /** Visible page text at the end of the case, trimmed for storage. */
  pageText?: string;
  /** Accessibility snapshot, when the case asked for one. */
  a11y?: string;
  /** Requests refused during the case so nothing real was charged or sent. */
  suppressed?: string[];
}

export interface CaseResult {
  caseKey: string;
  title: string;
  priority: TestPriority;
  category: string;
  status: TestStatus;
  expected?: string;
  actual?: string;
  reason?: string;
  url?: string;
  durationMs?: number;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Screenshots as base64 until the recorder uploads them. */
  images: Array<{ data: string; width?: number }>;
  evidence: CaseEvidence;
}

const MAX_TEXT = 4_000;
const MAX_LIST = 10;

const trim = (value: string | undefined, max = MAX_TEXT) =>
  value ? value.slice(0, max) : undefined;

/**
 * Decide the outcome of one case from its browser report. Pure.
 *
 * Failure rules, in order of severity:
 *   - the browser never reached the app            -> blocked
 *   - a required action failed                     -> failed
 *   - an uncaught page error (when the case cares) -> failed
 *   - an error screen appeared                     -> failed
 *   - the expected text/URL is absent              -> failed
 */
export function judgeCase(
  testCase: TestCase,
  report: BrowseReport,
  /** The run's throwaway identity, so its password never reaches storage. */
  identity?: { password?: string } | null,
): CaseResult {
  const images = report.steps
    .filter((s) => s.image)
    .slice(0, 4)
    .map((s) => ({ data: s.image!, width: s.width }));

  // Everything textual that leaves this function is scrubbed of credentials
  // before it is stored, prompted with, or shown.
  const scrub = (value: string | undefined) => redactWithIdentity(value, identity) || undefined;

  const pageText = scrub(
    report.steps
      .filter((s) => s.action === "text" && s.ok && s.data)
      .map((s) => s.data!)
      .join("\n"),
  );
  const a11y = scrub(report.steps.find((s) => s.action === "a11y" && s.ok)?.data);

  const base: CaseResult = {
    caseKey: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    category: testCase.category,
    status: "passed",
    expected: testCase.expect.textIncludes ?? testCase.expect.urlIncludes,
    url: report.finalUrl,
    durationMs: report.durationMs,
    consoleErrors: redactAll(report.consoleErrors).slice(0, MAX_LIST),
    pageErrors: redactAll(report.pageErrors).slice(0, MAX_LIST),
    failedRequests: redactAll(report.failedRequests).slice(0, MAX_LIST),
    images,
    evidence: {
      screenshots: [],
      pageText: trim(pageText),
      a11y: trim(a11y, 8_000),
      ...(report.suppressed?.length ? { suppressed: redactAll(report.suppressed) } : {}),
    },
  };

  const fail = (reason: string, actual?: string): CaseResult => ({
    ...base,
    status: "failed",
    reason: redactWithIdentity(reason, identity),
    actual: trim(redactWithIdentity(actual, identity) || undefined, 600),
  });

  // The session itself could not run — nothing was proven either way.
  const firstGoto = report.steps.find((s) => s.action === "goto");
  if (!report.ok && (!firstGoto || !firstGoto.ok)) {
    return {
      ...base,
      status: "blocked",
      reason: firstGoto?.error
        ? `Could not open the page: ${trim(redactSecrets(firstGoto.error), 300)}`
        : "The app could not be reached",
    };
  }

  const requiredFailure = report.steps.find((s) => !s.ok);
  if (requiredFailure) {
    return fail(
      `Step "${requiredFailure.action}" did not work`,
      requiredFailure.error ?? undefined,
    );
  }

  if (testCase.expect.noPageErrors !== false && report.pageErrors.length) {
    return fail("The page crashed while it was open", report.pageErrors[0]);
  }

  const haystack = `${pageText}\n${a11y ?? ""}`.toLowerCase();

  for (const bad of testCase.expect.textExcludes ?? []) {
    if (haystack.includes(bad.toLowerCase())) {
      return fail(`An error screen appeared ("${bad}")`, bad);
    }
  }

  if (testCase.expect.textIncludes) {
    const want = testCase.expect.textIncludes.toLowerCase();
    if (!haystack.includes(want)) {
      return fail(
        `Expected to see "${testCase.expect.textIncludes}" but it was not on the page`,
        trim(pageText, 600),
      );
    }
  }

  if (testCase.expect.urlIncludes) {
    if (!report.finalUrl.includes(testCase.expect.urlIncludes)) {
      return fail(
        `Expected to end up on a page containing "${testCase.expect.urlIncludes}"`,
        report.finalUrl,
      );
    }
  }

  return base;
}

/** A case we never got to run — recorded honestly, never as a pass. */
export function skippedResult(testCase: TestCase, reason: string): CaseResult {
  return {
    caseKey: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    category: testCase.category,
    status: "skipped",
    reason,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    images: [],
    evidence: { screenshots: [] },
  };
}

/** A case that could not be tested at all (no browser, missing credential…). */
export function blockedResult(testCase: TestCase, reason: string): CaseResult {
  return { ...skippedResult(testCase, reason), status: "blocked" };
}

export interface RunTotals {
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  p0Failed: number;
  p0Blocked: number;
}

export function tallyResults(results: CaseResult[]): RunTotals {
  const totals: RunTotals = {
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    p0Failed: 0,
    p0Blocked: 0,
  };
  for (const r of results) {
    totals[r.status] += 1;
    if (r.priority === "P0" && r.status === "failed") totals.p0Failed += 1;
    if (r.priority === "P0" && r.status === "blocked") totals.p0Blocked += 1;
  }
  return totals;
}

/** Run-level verdict. Blocked P0 work is never a pass. */
export function runStatusFor(totals: RunTotals): RunStatus {
  if (totals.failed > 0) return "failed";
  if (totals.p0Blocked > 0 || (totals.blocked > 0 && totals.passed === 0)) return "blocked";
  return "passed";
}

// ---------------------------------------------------------------- recording

export async function startTestRun(args: {
  projectId: string;
  buildId?: string | null;
  turnId?: string | null;
  budget: string;
  baseUrl?: string | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("project_test_runs")
      .insert({
        project_id: args.projectId,
        build_id: args.buildId ?? null,
        turn_id: args.turnId ?? null,
        budget: args.budget,
        base_url: args.baseUrl ?? null,
        status: "running",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.warn("[test-results] startTestRun failed", err);
    return null;
  }
}

/** Upload one screenshot; returns its storage path, or null if it didn't land. */
async function uploadScreenshot(args: {
  runId: string;
  caseKey: string;
  index: number;
  base64: string;
}): Promise<string | null> {
  try {
    const bin = atob(args.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `${args.runId}/${args.caseKey}-${args.index}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return path;
  } catch (err) {
    console.warn("[test-results] screenshot upload failed", err);
    return null;
  }
}

export async function recordCase(args: {
  runId: string;
  projectId: string;
  attempt?: number;
  result: CaseResult;
}): Promise<void> {
  const { result } = args;
  try {
    const screenshots: string[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const path = await uploadScreenshot({
        runId: args.runId,
        caseKey: result.caseKey,
        index: i,
        base64: result.images[i].data,
      });
      if (path) screenshots.push(path);
    }

    await supabaseAdmin.from("project_test_cases").insert({
      run_id: args.runId,
      project_id: args.projectId,
      case_key: result.caseKey,
      title: result.title,
      priority: result.priority,
      category: result.category,
      status: result.status,
      attempt: args.attempt ?? 1,
      expected: result.expected ?? null,
      actual: result.actual ?? null,
      reason: result.reason ?? null,
      url: result.url ?? null,
      duration_ms: result.durationMs ?? null,
      console_errors: result.consoleErrors,
      page_errors: result.pageErrors,
      failed_requests: result.failedRequests,
      evidence: { ...result.evidence, screenshots },
    });
  } catch (err) {
    console.warn("[test-results] recordCase failed", err);
  }
}

export async function finishTestRun(args: {
  runId: string;
  results: CaseResult[];
  blockedReason?: string | null;
}): Promise<RunStatus> {
  const totals = tallyResults(args.results);
  const status = runStatusFor(totals);
  try {
    await supabaseAdmin
      .from("project_test_runs")
      .update({
        status,
        totals: { ...totals },
        blocked_reason: args.blockedReason ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", args.runId);
  } catch (err) {
    console.warn("[test-results] finishTestRun failed", err);
  }
  return status;
}

/**
 * The recorded cases for a build's most recent test run, rehydrated as
 * `CaseResult`s. Used by the readiness gate; returns an empty list when no run
 * exists for the build, which callers treat as "no Test Lab evidence".
 */
export async function loadCasesForBuild(buildId: string): Promise<CaseResult[]> {
  try {
    const { data: runs } = await supabaseAdmin
      .from("project_test_runs")
      .select("id")
      .eq("build_id", buildId)
      .order("started_at", { ascending: false })
      .limit(1);
    const runId = runs?.[0]?.id;
    if (!runId) return [];

    const { data: rows } = await supabaseAdmin
      .from("project_test_cases")
      .select(
        "case_key,title,priority,category,status,expected,actual,reason,url,duration_ms,console_errors,page_errors,failed_requests,evidence",
      )
      .eq("run_id", runId);

    return (rows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
      return {
        caseKey: String(r.case_key),
        title: String(r.title ?? ""),
        priority: r.priority as CaseResult["priority"],
        category: String(r.category ?? ""),
        status: r.status as CaseResult["status"],
        expected: (r.expected as string | null) ?? undefined,
        actual: (r.actual as string | null) ?? undefined,
        reason: (r.reason as string | null) ?? undefined,
        url: (r.url as string | null) ?? undefined,
        durationMs: (r.duration_ms as number | null) ?? undefined,
        consoleErrors: list(r.console_errors),
        pageErrors: list(r.page_errors),
        failedRequests: list(r.failed_requests),
        images: [],
        evidence: (r.evidence ?? {}) as CaseResult["evidence"],
      } satisfies CaseResult;
    });
  } catch (err) {
    console.warn("[test-results] loadCasesForBuild failed", err);
    return [];
  }
}



/** Signed URLs for the UI. Evidence lives in a private bucket. */
export async function signEvidence(paths: string[], expiresIn = 3_600): Promise<string[]> {
  if (!paths.length) return [];
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrls(paths, expiresIn);
    if (error) throw error;
    return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
  } catch (err) {
    console.warn("[test-results] signEvidence failed", err);
    return [];
  }
}
