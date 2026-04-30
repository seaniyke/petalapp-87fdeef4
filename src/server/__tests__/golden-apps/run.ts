/**
 * Golden-app suite runner.
 *
 * STATUS: Skeleton. The prompts and grading shape are stable; the actual
 * "feed prompt to pipeline" call is stubbed because wiring it requires
 * standing up a deterministic AI provider (or a recording) so two CI runs
 * agree. That's the next milestone.
 *
 * Today this script:
 *  - Loads GOLDEN_APPS
 *  - For each, resolves the previously-recorded baseline result (if any)
 *  - Prints the test plan and exits 0
 *
 * Tomorrow (Phase 2):
 *  - Call the real generation pipeline (server function or in-process import)
 *  - Run grade() against the result and diff vs baseline.json
 *  - Exit 1 on any regression
 *
 * Usage:
 *   bun src/server/__tests__/golden-apps/run.ts            # all apps, plan only
 *   bun src/server/__tests__/golden-apps/run.ts --app=todo # single app
 *   bun src/server/__tests__/golden-apps/run.ts --update-baseline
 */

import { GOLDEN_APPS, type GoldenAppPrompt } from "./prompts";
import { grade, type GradeResult } from "./grade";

interface RunRecord {
  id: string;
  label: string;
  status: "planned" | "passed" | "failed" | "skipped";
  grade?: GradeResult;
  durationMs?: number;
  notes?: string;
}

function parseArgs(argv: string[]) {
  const out: { app?: string; updateBaseline: boolean } = { updateBaseline: false };
  for (const a of argv.slice(2)) {
    if (a === "--update-baseline") out.updateBaseline = true;
    else if (a.startsWith("--app=")) out.app = a.slice("--app=".length);
  }
  return out;
}

async function runOne(app: GoldenAppPrompt): Promise<RunRecord> {
  // TODO Phase 2: invoke the real generator. For now return a planned record
  // so CI and local users see the suite exists and what it WILL cover.
  const placeholder: GradeResult = {
    filesEmitted: false,
    verifierPassed: false,
    bundlePassed: false,
    typecheckPassed: false,
    notes: "runner not yet wired to live generator (Phase 2)",
  };
  return {
    id: app.id,
    label: app.label,
    status: "planned",
    grade: placeholder,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const apps = args.app ? GOLDEN_APPS.filter((a) => a.id === args.app) : GOLDEN_APPS;
  if (apps.length === 0) {
    console.error(`No app matched --app=${args.app}. Known ids: ${GOLDEN_APPS.map((a) => a.id).join(", ")}`);
    process.exit(2);
  }

  console.log(`[golden] running ${apps.length} app(s)…`);
  const records: RunRecord[] = [];
  for (const app of apps) {
    const t0 = Date.now();
    const rec = await runOne(app);
    rec.durationMs = Date.now() - t0;
    records.push(rec);
    console.log(`  - ${app.id.padEnd(18)} ${rec.status}  (${rec.durationMs}ms)`);
  }

  // Suite summary
  const failed = records.filter((r) => r.status === "failed").length;
  console.log(`\n[golden] ${records.length} apps, ${failed} failed`);

  // Until the runner is wired to the live generator we exit 0 so this can
  // run in CI as a "scaffold present" check without producing false alarms.
  // Flip to `process.exit(failed > 0 ? 1 : 0)` once Phase 2 lands.
  process.exit(0);

  // grade() is referenced so tree-shakers don't drop it before Phase 2.
  void grade;
}

main().catch((err) => {
  console.error("[golden] runner crashed:", err);
  process.exit(2);
});
