/**
 * Track B — live runner.
 *
 * Runs golden-app prompts through the real Lovable AI gateway, grades the
 * output with the same gates the replay-mode harness uses, and writes
 * each run to fixtures/<app>/runs/<timestamp>-<model>.json.
 *
 *   bun src/server/__tests__/golden-apps/run-live.ts                 # dry-run, no spend
 *   bun src/server/__tests__/golden-apps/run-live.ts --confirm       # 1 app × 3 runs (~$0.15)
 *   bun src/server/__tests__/golden-apps/run-live.ts --confirm --app=blog --runs=1
 *   bun src/server/__tests__/golden-apps/run-live.ts --confirm --all  # every app
 *   bun src/server/__tests__/golden-apps/run-live.ts --confirm --model=openai/gpt-5-mini
 *
 * Exit codes:
 *   0 — dry-run printed plan, OR live run finished and >=50% of runs passed
 *   1 — live run finished and <50% of runs passed (regression signal)
 *   2 — runner crash, missing API key, or invalid CLI args
 *
 * Hard guardrails (industry standard for spend-capable test tools):
 *   - Default is dry-run. --confirm is required to spend a single token.
 *   - Hard cap of 10 apps × 5 runs per invocation.
 *   - Estimated cost is printed before any network call, even with --confirm.
 *   - One model per invocation (no accidental matrix runs).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  GOLDEN_APPS,
  type GoldenAppPrompt,
} from "./prompts";
import { gradeFull, isPassing, type FullGradeResult } from "./replay";
import { callLiveModel, estimateCostUsd, estimatePlannedCostUsd } from "./live-client";
import { WRITE_PROJECT_TOOL, SYSTEM_PROMPT_INITIAL } from "@/server/generate.server";
import type { GeneratedApp } from "./grade";

const RUNS_DIR_NAME = "runs";
const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname;
const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const HARD_CAP_APPS = 10;
const HARD_CAP_RUNS = 5;

interface Args {
  confirm: boolean;
  all: boolean;
  app?: string;
  runs: number;
  model: string;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const out: Args = {
    confirm: false,
    all: false,
    runs: 3,
    model: DEFAULT_MODEL,
  };
  for (const a of argv.slice(2)) {
    if (a === "--confirm") out.confirm = true;
    else if (a === "--all") out.all = true;
    else if (a.startsWith("--app=")) out.app = a.slice("--app=".length);
    else if (a.startsWith("--runs=")) {
      const n = Number(a.slice("--runs=".length));
      if (!Number.isFinite(n) || n < 1) return { error: `bad --runs=${a}` };
      out.runs = n;
    } else if (a.startsWith("--model=")) out.model = a.slice("--model=".length);
    else if (a === "--help" || a === "-h") return { error: "help" };
    else return { error: `unknown flag: ${a}` };
  }
  if (out.runs > HARD_CAP_RUNS) return { error: `--runs capped at ${HARD_CAP_RUNS}` };
  return out;
}

function selectApps(args: Args): GoldenAppPrompt[] | { error: string } {
  if (args.app) {
    const found = GOLDEN_APPS.find((a) => a.id === args.app);
    if (!found) {
      return {
        error: `unknown --app=${args.app}. Known: ${GOLDEN_APPS.map((a) => a.id).join(", ")}`,
      };
    }
    return [found];
  }
  if (args.all) return [...GOLDEN_APPS].slice(0, HARD_CAP_APPS);
  // Default: just the first app. Stability comes from --runs, breadth from --all.
  return [GOLDEN_APPS[0]];
}

function tsStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

interface RunRecord {
  appId: string;
  attempt: number;
  model: string;
  ts: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  costUsd?: number;
  grade?: FullGradeResult;
  error?: string;
}

async function runOne(
  app: GoldenAppPrompt,
  attempt: number,
  model: string,
): Promise<RunRecord> {
  const ts = tsStamp();
  const result = await callLiveModel({
    model,
    systemPrompt: SYSTEM_PROMPT_INITIAL,
    userPrompt: app.prompt,
    tool: WRITE_PROJECT_TOOL,
    toolName: "write_project",
  });

  const costUsd =
    result.usage?.prompt_tokens != null && result.usage?.completion_tokens != null
      ? estimateCostUsd(model, result.usage.prompt_tokens, result.usage.completion_tokens)
      : undefined;

  if (!result.ok || !result.toolArgs?.files?.length) {
    return {
      appId: app.id,
      attempt,
      model,
      ts,
      ok: false,
      status: result.status,
      latencyMs: result.latencyMs,
      usage: result.usage,
      costUsd,
      error: result.error ?? "no files emitted",
    };
  }

  const generated: GeneratedApp = {
    files: result.toolArgs.files,
    changedPaths: result.toolArgs.files.map((f) => f.path),
  };
  const grade = await gradeFull(app, generated);
  const passed = isPassing(grade);

  // Persist the full run for offline inspection and future replay promotion.
  const dir = path.join(FIXTURES_DIR, app.id, RUNS_DIR_NAME);
  await ensureDir(dir);
  const safeModel = model.replace(/[\/.]/g, "-");
  const outFile = path.join(dir, `${ts}-${safeModel}-attempt${attempt}.json`);
  await fs.writeFile(
    outFile,
    JSON.stringify(
      { app: app.id, model, attempt, ts, generated, grade, usage: result.usage, costUsd },
      null,
      2,
    ),
    "utf8",
  );

  return {
    appId: app.id,
    attempt,
    model,
    ts,
    ok: passed,
    status: result.status,
    latencyMs: result.latencyMs,
    usage: result.usage,
    costUsd,
    grade,
  };
}

function printDryRun(args: Args, apps: GoldenAppPrompt[]) {
  const totalCalls = apps.length * args.runs;
  const perCallUsd = estimatePlannedCostUsd(args.model);
  const totalUsd = perCallUsd * totalCalls;
  console.log("=== Track B — DRY RUN ===");
  console.log(`Model:           ${args.model}`);
  console.log(`Apps (${apps.length}):       ${apps.map((a) => a.id).join(", ")}`);
  console.log(`Runs per app:    ${args.runs}`);
  console.log(`Total calls:     ${totalCalls}`);
  console.log(`Est. per call:   $${perCallUsd.toFixed(4)} (heuristic)`);
  console.log(`Est. total:      $${totalUsd.toFixed(4)}`);
  console.log("");
  console.log("No tokens will be spent. Re-run with --confirm to actually call the model.");
}

function printGradeLine(rec: RunRecord) {
  const mark = rec.ok ? "✓" : "✗";
  const cost = rec.costUsd != null ? `$${rec.costUsd.toFixed(4)}` : "$?";
  const tokens = rec.usage?.total_tokens ?? "?";
  const detail = rec.ok
    ? ""
    : ` — ${rec.error ?? gradeFailReason(rec.grade)}`;
  console.log(
    `  ${mark} ${rec.appId.padEnd(14)} attempt ${rec.attempt}/?  ${rec.latencyMs}ms  ${tokens}t  ${cost}${detail}`,
  );
}

function gradeFailReason(g: FullGradeResult | undefined): string {
  if (!g) return "no grade";
  if (!g.filesEmitted) return "no files";
  if (g.expectedFilesPresent === false) return "expected files missing";
  if (!g.verifierPassed) {
    const issues = (g.issues ?? []).slice(0, 2).join(" | ");
    return `verifier: ${issues || "failed"}`;
  }
  if (!g.esbuildPassed) {
    const issues = (g.esbuildIssues ?? []).slice(0, 2).join(" | ");
    return `esbuild: ${issues || "failed"}`;
  }
  return "failed";
}

async function main() {
  const argsOrErr = parseArgs(process.argv);
  if ("error" in argsOrErr) {
    if (argsOrErr.error === "help") {
      console.log(
        "Usage: bun run-live.ts [--confirm] [--all|--app=ID] [--runs=N] [--model=ID]",
      );
      process.exit(0);
    }
    console.error(`error: ${argsOrErr.error}`);
    process.exit(2);
  }
  const args = argsOrErr;

  const appsOrErr = selectApps(args);
  if ("error" in appsOrErr) {
    console.error(`error: ${appsOrErr.error}`);
    process.exit(2);
  }
  const apps = appsOrErr;

  if (!args.confirm) {
    printDryRun(args, apps);
    process.exit(0);
  }

  if (!process.env.LOVABLE_API_KEY) {
    console.error("error: LOVABLE_API_KEY is not set in the environment");
    process.exit(2);
  }

  const totalCalls = apps.length * args.runs;
  console.log(`=== Track B — LIVE (${totalCalls} call${totalCalls === 1 ? "" : "s"}) ===`);
  console.log(`Model: ${args.model}`);
  console.log("");

  const records: RunRecord[] = [];
  for (const app of apps) {
    console.log(`▶ ${app.id} — "${app.prompt}"`);
    for (let attempt = 1; attempt <= args.runs; attempt++) {
      const rec = await runOne(app, attempt, args.model);
      records.push(rec);
      printGradeLine(rec);
      // Light pacing — gateway is rate-limited per minute.
      if (attempt < args.runs) await new Promise((r) => setTimeout(r, 1500));
    }
    console.log("");
  }

  // Roll up per-app stability + total spend.
  const byApp = new Map<string, RunRecord[]>();
  for (const r of records) {
    const list = byApp.get(r.appId) ?? [];
    list.push(r);
    byApp.set(r.appId, list);
  }
  const totalCost = records.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalPassed = records.filter((r) => r.ok).length;

  console.log("=== Summary ===");
  for (const [id, runs] of byApp) {
    const passed = runs.filter((r) => r.ok).length;
    const stability =
      runs.length > 0 ? `${passed}/${runs.length}` : "0/0";
    const flag = passed === runs.length ? "✓" : passed === 0 ? "✗" : "~";
    console.log(`  ${flag} ${id.padEnd(14)} ${stability} passed`);
  }
  console.log("");
  console.log(`Total: ${totalPassed}/${records.length} passed   spend ≈ $${totalCost.toFixed(4)}`);
  console.log(`Run logs: src/server/__tests__/golden-apps/fixtures/<app>/runs/`);

  // <50% pass rate is a regression signal worthy of a non-zero exit.
  process.exit(totalPassed * 2 >= records.length ? 0 : 1);
}

main().catch((err) => {
  console.error("[live] runner crashed:", err);
  process.exit(2);
});
