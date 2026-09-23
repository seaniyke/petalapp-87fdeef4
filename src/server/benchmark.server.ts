/**
 * W5 — nightly benchmark harness.
 *
 * Runs the frozen suite in `benchmark-suite.ts` end to end, exactly the way a
 * real user would: mint a session for a dedicated bench account, create a
 * project, POST the prompt to `/api/generate`, trigger a real build, wait for
 * the deploy + browser verification to land, then score the result on five
 * axes:
 *
 *   build completion      — did the build reach `ready`?
 *   functional correctness— did the browser agent find blocking defects?
 *   spec adherence        — how many of the case's PRD criteria are met?
 *   visual quality        — the vision pass's own score / visual defects
 *   regression safety     — did any criterion that passed last run now fail?
 *
 * Everything is written to `benchmark_runs` / `benchmark_cases` so scores are
 * comparable night over night. Nothing here mutates product behaviour: the
 * harness is a consumer of the same public surfaces the app uses.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { partitionVerificationDefects } from "@/lib/verification-report";
import { BENCHMARK_SUITE, type BenchmarkCase } from "@/server/benchmark-suite";

const BENCH_EMAIL = "benchmark@bench.buildwithpetal.com";
/**
 * Per-phase ceilings, not a single per-case one. A case that builds an app and
 * then edits it pays for two generations and two builds; sharing one 12-minute
 * budget between them made a healthy edit case look like a product timeout
 * when the initial build alone had taken nine minutes.
 */
const GENERATION_TIMEOUT_MS = 12 * 60_000;
const BUILD_TIMEOUT_MS = 8 * 60_000;
const BUILD_POLL_MS = 5_000;
/** Judge model for spec adherence. Cheap: it reads criteria, not architecture. */
const SPEC_JUDGE_MODEL = "google/gemini-3.1-flash-lite";

function baseUrl(): string {
  return (
    process.env.PETAL_BENCH_BASE_URL ??
    process.env.PETAL_PUBLIC_BASE_URL ??
    process.env.PETAL_PUBLIC_ORIGIN ??
    "https://buildwithpetal.com"
  );
}

export interface CriterionResult {
  id: string;
  text: string;
  passed: boolean;
  note?: string;
}

/**
 * Exactly one primary verdict per case. The point of the split is that a
 * dropped socket or an unreadable judge can never be filed as "Kimble failed",
 * and a genuine product failure can never hide behind them either.
 */
export type BenchmarkClassification =
  | "PASS — PRODUCT"
  | "FAIL — PRODUCT"
  | "FAIL — INFRASTRUCTURE"
  | "FAIL — BENCHMARK"
  | "INCONCLUSIVE";

export interface BenchmarkTelemetry {
  phases: Array<{ name: string; ms: number }>;
  /** Minimal change surface: how many files the follow-up turn actually changed. */
  changeSurface?: {
    filesBefore: number;
    filesChanged: number;
    changedPaths: string[];
    maxAllowed?: number;
  };
}

export interface BenchmarkCaseResult {
  caseId: string;
  title: string;
  projectId: string | null;
  buildId: string | null;
  status: "passed" | "failed" | "errored";
  classification: BenchmarkClassification;
  buildCompleted: boolean;
  functionalCorrectness: number;
  specAdherence: number;
  visualQuality: number;
  regressionSafety: number;
  criteria: CriterionResult[];
  defects: string[];
  durationMs: number;
  telemetry: BenchmarkTelemetry;
  errorMessage?: string;
}


/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mint a real access token for the bench account. We go through the normal
 * magic-link + verifyOtp path rather than forging a JWT so the harness is
 * subject to exactly the same auth the product enforces.
 */
async function mintBenchSession(): Promise<{ token: string; userId: string }> {
  const url = process.env.SUPABASE_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) throw new Error("Supabase env missing for benchmark run");

  // Idempotent: the account survives between runs, we just ignore the
  // "already registered" error on subsequent nights.
  const created = await supabaseAdmin.auth.admin.createUser({
    email: BENCH_EMAIL,
    email_confirm: true,
  });
  let userId = created.data.user?.id ?? null;
  if (!userId) {
    const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = list.data.users.find((u) => u.email === BENCH_EMAIL)?.id ?? null;
  }
  if (!userId) throw new Error("Could not resolve benchmark user");

  const link = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: BENCH_EMAIL,
  });
  const hashed = link.data.properties?.hashed_token;
  if (!hashed) throw new Error("Could not mint benchmark session");

  const anon = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: hashed, type: "email" });
  if (error || !data.session?.access_token) {
    throw new Error(`Benchmark sign-in failed: ${error?.message ?? "no session"}`);
  }
  await ensureBenchCredits(userId);
  return { token: data.session.access_token, userId };
}

/**
 * The bench account is an ordinary free account, so a long run drains its
 * daily allowance and every later case stalls on "Waiting for credits".
 * Top it back up before each run so the suite measures the pipeline, not
 * the wallet.
 */
async function ensureBenchCredits(userId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("user_wallets")
      .update({ topup_credits_remaining: 5000, credit_debt: 0 } as never)
      .eq("user_id", userId);
  } catch (err) {
    console.warn("[benchmark] could not top up bench wallet", err);
  }
}

/* ------------------------------------------------------------------ */
/* One case                                                            */
/* ------------------------------------------------------------------ */

async function createBenchProject(userId: string, testCase: BenchmarkCase): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      owner_id: userId,
      title: `bench/${testCase.id}/${new Date().toISOString().slice(0, 10)}`,
      is_public: false,
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create bench project: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Drive `/api/generate` and drain the SSE stream to completion. */
async function runGeneration(
  token: string,
  projectId: string,
  prompt: string,
  signal: AbortSignal,
  messages?: Array<{ role: string; content: string }>,
  currentFiles?: Array<{ path: string; content: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${baseUrl()}/api/generate`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-petal-target": "web",
    },
    body: JSON.stringify({
      projectId,
      currentFiles: currentFiles ?? [],
      messages: messages ?? [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok || !res.body) {
    return { ok: false, error: `generate ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | undefined;
  let sawTerminal = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const evt = JSON.parse(raw) as { type?: string; message?: string; status?: string };
        if (evt.type === "error") streamError = evt.message ?? "stream error";
        if (evt.type === "done" || evt.type === "result") sawTerminal = true;
      } catch {
        /* partial frame — the next chunk completes it */
      }
    }
  }
  if (streamError) return { ok: false, error: streamError };
  if (!sawTerminal) return { ok: false, error: "generation stream ended without a terminal event" };
  return { ok: true };
}

interface BuildOutcome {
  buildId: string | null;
  status: string;
  defects: string[];
  visualScore: number | null;
  errorMessage?: string;
}

async function runBuild(token: string, projectId: string, deadline: number): Promise<BuildOutcome> {
  const res = await fetch(`${baseUrl()}/api/builds/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    return {
      buildId: null,
      status: "failed",
      defects: [],
      visualScore: null,
      errorMessage: `build trigger ${res.status}: ${(await res.text()).slice(0, 300)}`,
    };
  }
  const triggered = (await res.json().catch(() => ({}))) as { buildId?: string; id?: string };
  const buildId = triggered.buildId ?? triggered.id ?? null;

  for (;;) {
    if (Date.now() > deadline) {
      return { buildId, status: "timeout", defects: [], visualScore: null, errorMessage: "build timed out" };
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_MS));
    const query = supabaseAdmin
      .from("project_builds")
      .select("id, status, error_message, verification")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1);
    const { data } = buildId
      ? await supabaseAdmin
          .from("project_builds")
          .select("id, status, error_message, verification")
          .eq("id", buildId)
          .maybeSingle()
          .then((r) => ({ data: r.data ? [r.data] : [] }))
      : await query;
    const row = data?.[0] as
      | { id: string; status: string; error_message: string | null; verification: unknown }
      | undefined;
    if (!row) continue;
    if (row.status === "pending" || row.status === "building" || row.status === "verifying") continue;

    const verification = (row.verification ?? {}) as { defects?: unknown; visualScore?: unknown };
    const defects = Array.isArray(verification.defects)
      ? verification.defects.filter((d): d is string => typeof d === "string")
      : [];
    return {
      buildId: row.id,
      status: row.status,
      defects,
      visualScore: typeof verification.visualScore === "number" ? verification.visualScore : null,
      errorMessage: row.error_message ?? undefined,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Spec adherence: read the generated source and decide, per criterion,
 * whether the app actually does the thing the PRD asked for. This is the one
 * place the harness needs judgement — everything else is measured.
 */
/** A case is scored on its build criteria plus, when present, its edit criteria. */
function allCriteria(testCase: BenchmarkCase): BenchmarkCase["criteria"] {
  return testCase.followUp ? [...testCase.criteria, ...testCase.followUp.criteria] : testCase.criteria;
}

/**
 * Pull a JSON object out of a judge reply that may be wrapped in prose, a
 * ```json fence, or both. A judge that answers in the wrong shape is a
 * benchmark failure, not a product failure, so the caller needs to know the
 * difference — hence `judgeFailed` rather than a silent all-false verdict.
 */
export function extractJudgeJson(text: string): unknown | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text.trim());
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

export interface SpecScore {
  criteria: CriterionResult[];
  /** True when the judge could not be read — the test failed, not the app. */
  judgeFailed: boolean;
}

async function scoreSpecAdherence(
  projectId: string,
  testCase: BenchmarkCase,
  criteriaList: BenchmarkCase["criteria"] = allCriteria(testCase),
): Promise<SpecScore> {
  const fallback = (note: string, judgeFailed: boolean): SpecScore => ({
    criteria: criteriaList.map((c) => ({ id: c.id, text: c.text, passed: false, note })),
    judgeFailed,
  });

  const { data: files } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  if (!files?.length) return fallback("no files generated", false);

  const relevant = (files as Array<{ path: string; content: string }>)
    .filter((f) => /\.(tsx?|jsx?|css|html)$/.test(f.path) && !f.path.includes("node_modules"))
    .slice(0, 40)
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6000)}`)
    .join("\n\n")
    .slice(0, 180_000);

  // One retry: a judge that fumbles the format once usually gets it right the
  // second time, and a reroll is far cheaper than discarding a real result.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await aiChatCompletions({
        feature: "design",
        budgetAware: true,
        body: {
          model: SPEC_JUDGE_MODEL,
          temperature: 0,
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content:
                "You audit generated app source against acceptance criteria. For each criterion answer strictly from the code: pass only when the code plainly implements it. Reply with raw JSON only — no prose, no markdown fences: {\"results\":[{\"id\":\"...\",\"passed\":true|false,\"note\":\"<12 words\"}]}.",
            },
            {
              role: "user",
              content: `App brief: ${testCase.prompt}${
                testCase.followUp ? `\n\nThen the user asked: ${testCase.followUp.prompt}` : ""
              }\n\nCriteria:\n${criteriaList
                .map((c) => `- ${c.id}: ${c.text}`)
                .join("\n")}\n\nSource:\n${relevant}`,
            },
          ],
        },
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      const parsed = extractJudgeJson(text) as
        | { results?: Array<{ id?: string; passed?: boolean; note?: string }> }
        | null;
      const results = Array.isArray(parsed?.results) ? parsed.results : null;
      if (!results) continue;

      const byId = new Map(results.map((r) => [r.id, r]));
      // A judge that answered about none of our criteria did not read the
      // task. Treat that as unreadable rather than a clean sweep of failures.
      const matched = criteriaList.filter((c) => byId.has(c.id)).length;
      if (matched === 0) continue;

      return {
        judgeFailed: false,
        criteria: criteriaList.map((c) => {
          const hit = byId.get(c.id);
          return {
            id: c.id,
            text: c.text,
            passed: Boolean(hit?.passed),
            note: hit?.note ?? (hit ? undefined : "judge did not answer this criterion"),
          };
        }),
      };
    } catch (e) {
      if (attempt === 1) return fallback(`judge failed: ${(e as Error).message.slice(0, 80)}`, true);
    }
  }
  return fallback("judge reply could not be read", true);
}


/** Previous run's criterion outcomes for this case, for regression diffing. */
async function loadPreviousCriteria(caseId: string, currentRunId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("benchmark_cases")
    .select("criteria, created_at")
    .eq("case_id", caseId)
    .neq("run_id", currentRunId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0] as { criteria?: unknown } | undefined;
  const list = Array.isArray(row?.criteria) ? (row.criteria as CriterionResult[]) : [];
  return new Set(list.filter((c) => c.passed).map((c) => c.id));
}

/** The project's current source — an edit turn must not look like a first build. */
async function loadProjectFiles(projectId: string): Promise<Array<{ path: string; content: string }>> {
  const { data } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  return (data ?? []) as Array<{ path: string; content: string }>;
}

/**
 * Transport-level wording that proves the environment, not the product, ended
 * the case. These must never be scored as Kimble failing to do the work.
 */
const INFRA_ERROR_PATTERNS = [
  /socket connection was closed/i,
  /unable to connect/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i,
  /fetch failed/i,
  /network (?:error|request failed)/i,
  /\bUnauthorized\b/i,
  /operation was aborted/i,
  /\b5\d\d\b.*(?:gateway|unavailable|timeout)/i,
  /stream ended without a terminal event/i,
];

export function looksInfrastructural(message: string | undefined): boolean {
  if (!message) return false;
  return INFRA_ERROR_PATTERNS.some((p) => p.test(message));
}

async function runCase(
  token: string,
  userId: string,
  runId: string,
  testCase: BenchmarkCase,
): Promise<BenchmarkCaseResult> {
  const startedAt = Date.now();

  const base: BenchmarkCaseResult = {
    caseId: testCase.id,
    title: testCase.title,
    projectId: null,
    buildId: null,
    status: "errored",
    classification: "INCONCLUSIVE",
    buildCompleted: false,
    functionalCorrectness: 0,
    specAdherence: 0,
    visualQuality: 0,
    regressionSafety: 1,
    criteria: [],
    defects: [],
    durationMs: 0,
    telemetry: { phases: [] },
  };

  /** Run one phase under its own clock, and record how long it actually took. */
  const phase = async <T,>(
    name: string,
    limitMs: number,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ value: T | null; timedOut: boolean; ms: number }> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), limitMs);
    const t0 = Date.now();
    try {
      const value = await fn(abort.signal);
      return { value, timedOut: false, ms: Date.now() - t0 };
    } catch (e) {
      const timedOut = abort.signal.aborted;
      if (!timedOut) throw e;
      return { value: null, timedOut: true, ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
      base.telemetry.phases.push({ name, ms: Date.now() - t0 });
    }
  };

  try {
    const projectId = await createBenchProject(userId, testCase);
    base.projectId = projectId;

    const gen = await phase("generate:initial", GENERATION_TIMEOUT_MS, (signal) =>
      runGeneration(token, projectId, testCase.prompt, signal),
    );
    if (gen.timedOut) {
      base.errorMessage = `initial generation exceeded ${Math.round(GENERATION_TIMEOUT_MS / 1000)}s`;
      base.classification = "FAIL — PRODUCT";
      base.durationMs = Date.now() - startedAt;
      return base;
    }
    if (!gen.value?.ok) {
      base.errorMessage = gen.value?.error;
      base.classification = looksInfrastructural(base.errorMessage)
        ? "FAIL — INFRASTRUCTURE"
        : "FAIL — PRODUCT";
      base.durationMs = Date.now() - startedAt;
      return base;
    }

    const firstBuild = await phase("build:initial", BUILD_TIMEOUT_MS, () =>
      runBuild(token, projectId, Date.now() + BUILD_TIMEOUT_MS),
    );
    let build =
      firstBuild.value ??
      ({ buildId: null, status: "timeout", defects: [], visualScore: null, errorMessage: "build timed out" } as BuildOutcome);

    // Edit / redesign / recovery cases: same project, one more real turn, on
    // its own clock. The first build's cost must not eat the edit's budget —
    // that is what made multi-file-edit look like a product timeout.
    if (testCase.followUp && build.status === "ready") {
      const currentFiles = await loadProjectFiles(projectId);
      const edit = await phase("generate:edit", GENERATION_TIMEOUT_MS, (signal) =>
        runGeneration(
          token,
          projectId,
          testCase.followUp!.prompt,
          signal,
          [
            { role: "user", content: testCase.prompt },
            { role: "assistant", content: "Built." },
            { role: "user", content: testCase.followUp!.prompt },
          ],
          currentFiles,
        ),
      );
      if (edit.timedOut) {
        base.errorMessage = `follow-up generation exceeded ${Math.round(GENERATION_TIMEOUT_MS / 1000)}s`;
      } else if (!edit.value?.ok) {
        base.errorMessage = `follow-up: ${edit.value?.error}`;
      } else {
        const editBuild = await phase("build:edit", BUILD_TIMEOUT_MS, () =>
          runBuild(token, projectId, Date.now() + BUILD_TIMEOUT_MS),
        );
        if (editBuild.value) build = editBuild.value;

        // Minimal change surface: a one-line ask must not rewrite the project.
        const afterFiles = await loadProjectFiles(projectId);
        const before = new Map(currentFiles.map((f) => [f.path, f.content]));
        const changedPaths = afterFiles
          .filter((f) => before.get(f.path) !== f.content)
          .map((f) => f.path)
          .sort();
        base.telemetry.changeSurface = {
          filesBefore: currentFiles.length,
          filesChanged: changedPaths.length,
          changedPaths: changedPaths.slice(0, 50),
          maxAllowed: testCase.followUp.maxChangedFiles,
        };
      }
    }

    base.buildId = build.buildId;
    base.buildCompleted = build.status === "ready";
    base.defects = build.defects;
    if (build.errorMessage) base.errorMessage = build.errorMessage;

    const { blocking, visual } = partitionVerificationDefects(build.defects);
    base.functionalCorrectness = base.buildCompleted
      ? Math.max(0, 1 - 0.34 * blocking.length)
      : 0;

    // Vision pass score when we have one; otherwise infer from visual findings
    // so a build with no vision data isn't silently scored as perfect.
    base.visualQuality =
      build.visualScore != null
        ? Math.max(0, Math.min(1, build.visualScore > 1 ? build.visualScore / 100 : build.visualScore))
        : base.buildCompleted
          ? Math.max(0, 1 - 0.2 * visual.length)
          : 0;

    let judgeFailed = false;
    let criteria: CriterionResult[];
    if (base.buildCompleted) {
      const scored = await scoreSpecAdherence(projectId, testCase);
      criteria = scored.criteria;
      judgeFailed = scored.judgeFailed;
    } else {
      criteria = testCase.criteria.map((c) => ({
        id: c.id,
        text: c.text,
        passed: false,
        note: "build failed",
      }));
    }
    // Change surface is measured, not judged: it is a hard criterion.
    const surface = base.telemetry.changeSurface;
    if (surface?.maxAllowed != null) {
      const within = surface.filesChanged <= surface.maxAllowed;
      criteria = [
        ...criteria,
        {
          id: "minimal-change-surface",
          text: `The follow-up change touches at most ${surface.maxAllowed} files.`,
          passed: within,
          note: `${surface.filesChanged} file(s) changed${within ? "" : `: ${surface.changedPaths.slice(0, 10).join(", ")}`}`,
        },
      ];
    }

    base.criteria = criteria;
    base.specAdherence = criteria.length
      ? criteria.filter((c) => c.passed).length / criteria.length
      : 0;

    const previouslyPassing = await loadPreviousCriteria(testCase.id, runId);
    const regressed = criteria.filter((c) => previouslyPassing.has(c.id) && !c.passed);
    base.regressionSafety = previouslyPassing.size
      ? 1 - regressed.length / previouslyPassing.size
      : 1;

    const passed = base.buildCompleted && blocking.length === 0 && base.specAdherence >= 0.75;
    base.status = passed ? "passed" : "failed";

    // A judge we could not read tells us nothing about the app. Scoring that
    // as a product failure is exactly the mistake this pass removes.
    if (passed) base.classification = "PASS — PRODUCT";
    else if (judgeFailed) base.classification = "FAIL — BENCHMARK";
    else if (looksInfrastructural(base.errorMessage)) base.classification = "FAIL — INFRASTRUCTURE";
    else if (base.buildCompleted || build.status === "failed") base.classification = "FAIL — PRODUCT";
    else base.classification = "INCONCLUSIVE";

    base.durationMs = Date.now() - startedAt;
    return base;
  } catch (e) {
    console.error("[benchmark] case failed", testCase.id, e);
    base.errorMessage = (e as Error).message.slice(0, 500);
    base.classification = looksInfrastructural(base.errorMessage)
      ? "FAIL — INFRASTRUCTURE"
      : "INCONCLUSIVE";
    base.durationMs = Date.now() - startedAt;
    return base;
  }
}


/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

function mean(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
}

export interface NightlyBenchmarkOptions {
  trigger?: "cron" | "manual";
  /** Subset of case ids — used for manual smoke runs, never by the cron. */
  only?: string[];
}

export async function runNightlyBenchmark(options: NightlyBenchmarkOptions = {}) {
  const cases = options.only?.length
    ? BENCHMARK_SUITE.filter((c) => options.only!.includes(c.id))
    : BENCHMARK_SUITE;

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("benchmark_runs")
    .insert({
      status: "running",
      trigger: options.trigger ?? "cron",
      total_cases: cases.length,
    } as never)
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`Could not open benchmark run: ${runErr?.message}`);
  const runId = (runRow as { id: string }).id;

  try {
    const { token, userId } = await mintBenchSession();
    const results: BenchmarkCaseResult[] = [];
    const regressions: Array<{ caseId: string; criterionId: string; text: string }> = [];

    // Sequential on purpose: parallel runs would contend for builder capacity
    // and the timings would stop being comparable between nights.
    for (const testCase of cases) {
      const result = await runCase(token, userId, runId, testCase);
      results.push(result);

      const previouslyPassing = await loadPreviousCriteria(testCase.id, runId);
      for (const c of result.criteria) {
        if (previouslyPassing.has(c.id) && !c.passed) {
          regressions.push({ caseId: testCase.id, criterionId: c.id, text: c.text });
        }
      }

      await supabaseAdmin.from("benchmark_cases").insert({
        run_id: runId,
        case_id: result.caseId,
        title: result.title,
        classification: result.classification,
        telemetry: result.telemetry as never,
        prompt: testCase.prompt,

        project_id: result.projectId,
        build_id: result.buildId,
        status: result.status,
        build_completed: result.buildCompleted,
        functional_correctness: result.functionalCorrectness,
        spec_adherence: result.specAdherence,
        visual_quality: result.visualQuality,
        regression_safety: result.regressionSafety,
        criteria: result.criteria as never,
        defects: result.defects as never,
        duration_ms: result.durationMs,
        error_message: result.errorMessage ?? null,
      } as never);

      await supabaseAdmin
        .from("benchmark_runs")
        .update({ completed_cases: results.length } as never)
        .eq("id", runId);
    }

    const buildCompletion = mean(results.map((r) => (r.buildCompleted ? 1 : 0)));
    const functional = mean(results.map((r) => r.functionalCorrectness));
    const spec = mean(results.map((r) => r.specAdherence));
    const visual = mean(results.map((r) => r.visualQuality));
    const regression = mean(results.map((r) => r.regressionSafety));
    const overall = mean([buildCompletion, functional, spec, visual, regression]);

    await supabaseAdmin
      .from("benchmark_runs")
      .update({
        status: "complete",
        finished_at: new Date().toISOString(),
        completed_cases: results.length,
        build_completion: buildCompletion,
        functional_correctness: functional,
        spec_adherence: spec,
        visual_quality: visual,
        regression_safety: regression,
        overall_score: overall,
        regressions: regressions as never,
      } as never)
      .eq("id", runId);

    return { runId, cases: results.length, overall, regressions };
  } catch (e) {
    await supabaseAdmin
      .from("benchmark_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: (e as Error).message.slice(0, 500),
      } as never)
      .eq("id", runId);
    throw e;
  }
}
