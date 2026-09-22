/**
 * Test Lab reads — what Kimble checked on your app, and the proof.
 *
 * Two audiences, two shapes:
 *  - `getProjectTestRun` is for the person who owns the project. Plain
 *    language, the checks that matter, and signed links to the screenshots.
 *  - `getAdminTestRuns` is the internal view: every recent run across
 *    projects, with the raw per-case detail, for admins only.
 *
 * Evidence lives in a private bucket, so screenshot links are signed here and
 * expire. Nothing is returned for a project the caller does not own.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TestStatus } from "@/server/test-results.server";

export type TestCaseView = {
  caseKey: string;
  title: string;
  priority: string;
  category: string;
  status: TestStatus;
  reason?: string;
  expected?: string;
  actual?: string;
  url?: string;
  durationMs?: number;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshots: string[];
  suppressed: string[];
};

export type TestRunView = {
  runId: string;
  status: string;
  budget: string;
  baseUrl: string | null;
  blockedReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  totals: { passed: number; failed: number; blocked: number; skipped: number };
  headline: string;
  cases: TestCaseView[];
};

const EMPTY_TOTALS = { passed: 0, failed: 0, blocked: 0, skipped: 0 };

/** One sentence a non-technical person can act on. */
export function runHeadline(
  status: string,
  totals: { passed: number; failed: number; blocked: number; skipped: number },
): string {
  const checked = totals.passed + totals.failed + totals.blocked;
  if (status === "running") return "Kimble is checking your app right now.";
  if (totals.failed > 0) {
    return `${totals.failed} of ${checked} checks did not pass — the details are below.`;
  }
  if (totals.blocked > 0) {
    return `Kimble could not finish ${totals.blocked} check${totals.blocked === 1 ? "" : "s"}, so it has not claimed those work.`;
  }
  if (checked === 0) return "No checks were run for this build.";
  return `All ${checked} checks passed on your live app.`;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function totalsOf(raw: unknown) {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    passed: toNumber(t.passed),
    failed: toNumber(t.failed),
    blocked: toNumber(t.blocked),
    skipped: toNumber(t.skipped),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Latest Test Lab run for a project the caller owns. */
export const getProjectTestRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<TestRunView | null> => {
    const { supabase } = context;

    // RLS scopes both tables to the project owner, so no extra check is needed.
    const { data: run } = await supabase
      .from("project_test_runs")
      .select("id, status, budget, base_url, blocked_reason, started_at, finished_at, totals")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) return null;

    const { data: rows } = await supabase
      .from("project_test_cases")
      .select(
        "case_key, title, priority, category, status, reason, expected, actual, url, duration_ms, console_errors, page_errors, failed_requests, evidence",
      )
      .eq("run_id", run.id)
      .order("priority", { ascending: true });

    const paths: string[] = [];
    const cases: TestCaseView[] = (rows ?? []).map((r) => {
      const evidence = (r.evidence ?? {}) as Record<string, unknown>;
      const shots = strings(evidence.screenshots);
      paths.push(...shots);
      return {
        caseKey: r.case_key,
        title: r.title,
        priority: String(r.priority),
        category: String(r.category),
        status: r.status as TestStatus,
        reason: r.reason ?? undefined,
        expected: r.expected ?? undefined,
        actual: r.actual ?? undefined,
        url: r.url ?? undefined,
        durationMs: r.duration_ms ?? undefined,
        consoleErrors: strings(r.console_errors),
        pageErrors: strings(r.page_errors),
        failedRequests: strings(r.failed_requests),
        screenshots: shots,
        suppressed: strings(evidence.suppressed),
      };
    });

    // Swap storage paths for short-lived signed links.
    const { signEvidence } = await import("@/server/test-results.server");
    const signed = await signEvidence(paths);
    const linkFor = new Map<string, string>();
    paths.forEach((p, i) => {
      const url = signed[i];
      if (url) linkFor.set(p, url);
    });
    for (const c of cases) {
      c.screenshots = c.screenshots.map((p) => linkFor.get(p) ?? "").filter(Boolean);
    }

    const totals = totalsOf(run.totals) ?? EMPTY_TOTALS;
    return {
      runId: run.id,
      status: run.status,
      budget: run.budget,
      baseUrl: run.base_url,
      blockedReason: run.blocked_reason,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      totals,
      headline: runHeadline(run.status, totals),
      cases,
    };
  });

export type AdminTestRunRow = {
  runId: string;
  projectId: string;
  projectName: string | null;
  buildId: string | null;
  status: string;
  budget: string;
  startedAt: string;
  finishedAt: string | null;
  totals: { passed: number; failed: number; blocked: number; skipped: number };
  blockedReason: string | null;
};

export type AdminTestLabView = {
  unauthorized?: true;
  runs: AdminTestRunRow[];
  summary: {
    runs: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    failingRuns: number;
  };
};

/** Internal view across all projects. Admins only. */
export const getAdminTestRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ limit: z.number().min(1).max(100).optional() }).parse(data ?? {}))
  .handler(async ({ data, context }): Promise<AdminTestLabView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { unauthorized: true, runs: [], summary: { runs: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, failingRuns: 0 } };

    const { data: rows } = await supabaseAdmin
      .from("project_test_runs")
      .select("id, project_id, build_id, status, budget, started_at, finished_at, totals, blocked_reason")
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 50);

    const list = rows ?? [];
    const projectIds = [...new Set(list.map((r) => r.project_id))];
    const names = new Map<string, string | null>();
    if (projectIds.length) {
      const { data: projects } = await supabaseAdmin
        .from("projects")
        .select("id, slug, site_title")
        .in("id", projectIds);
      for (const p of projects ?? []) names.set(p.id, p.site_title ?? p.slug ?? null);
    }

    const runs: AdminTestRunRow[] = list.map((r) => ({
      runId: r.id,
      projectId: r.project_id,
      projectName: names.get(r.project_id) ?? null,
      buildId: r.build_id,
      status: r.status,
      budget: r.budget,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      totals: totalsOf(r.totals),
      blockedReason: r.blocked_reason,
    }));

    const summary = runs.reduce(
      (acc, r) => ({
        runs: acc.runs + 1,
        passed: acc.passed + r.totals.passed,
        failed: acc.failed + r.totals.failed,
        blocked: acc.blocked + r.totals.blocked,
        skipped: acc.skipped + r.totals.skipped,
        failingRuns: acc.failingRuns + (r.totals.failed > 0 ? 1 : 0),
      }),
      { runs: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, failingRuns: 0 },
    );

    return { runs, summary };
  });
