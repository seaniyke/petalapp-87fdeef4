/**
 * Golden-app suite runner — Phase 2.
 *
 * Loads each app's recorded fixture (see ./fixtures/) and runs it through
 * every gate the live build pipeline applies: file presence, local verifier
 * (esbuild + render-risk + RLS sanity), and the esbuild parse pass.
 *
 * Apps without a recorded fixture are SKIPPED (not failed) so we can land
 * fixtures incrementally without breaking CI.
 *
 * Usage:
 *   bun src/server/__tests__/golden-apps/run.ts            # all apps
 *   bun src/server/__tests__/golden-apps/run.ts --app=todo # single app
 *   bun src/server/__tests__/golden-apps/run.ts --strict   # skipped = failed
 *
 * Exit codes:
 *   0 — all graded apps passed (skipped apps are OK by default)
 *   1 — at least one graded app failed, or --strict and any app skipped
 *   2 — runner crash / unknown --app id
 */

import { GOLDEN_APPS, type GoldenAppPrompt } from "./prompts";
import { gradeFull, isPassing, loadFixture, type FullGradeResult } from "./replay";

interface RunRecord {
  id: string;
  label: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  result: FullGradeResult;
}

function parseArgs(argv: string[]) {
  const out: { app?: string; strict: boolean } = { strict: false };
  for (const a of argv.slice(2)) {
    if (a === "--strict") out.strict = true;
    else if (a.startsWith("--app=")) out.app = a.slice("--app=".length);
  }
  return out;
}

async function runOne(app: GoldenAppPrompt): Promise<RunRecord> {
  const t0 = Date.now();
  const fixture = await loadFixture(app.id);
  const result = await gradeFull(app, fixture);
  const status: RunRecord["status"] = result.fixtureMissing
    ? "skipped"
    : isPassing(result)
      ? "passed"
      : "failed";
  return {
    id: app.id,
    label: app.label,
    status,
    durationMs: Date.now() - t0,
    result,
  };
}

function printGateLine(label: string, ok: boolean | undefined, indent = 6) {
  const pad = " ".repeat(indent);
  const mark = ok === undefined ? "·" : ok ? "✓" : "✗";
  console.log(`${pad}${mark} ${label}`);
}

function reportFailure(rec: RunRecord) {
  const r = rec.result;
  console.log(`    failure detail for ${rec.id}:`);
  printGateLine("files emitted", r.filesEmitted);
  printGateLine("expected files present", r.expectedFilesPresent);
  printGateLine("local verifier", r.verifierPassed);
  printGateLine("esbuild parse", r.esbuildPassed);
  if (r.issues?.length) {
    console.log("      verifier issues:");
    for (const i of r.issues.slice(0, 8)) console.log(`        - ${i}`);
    if (r.issues.length > 8) console.log(`        … (${r.issues.length - 8} more)`);
  }
  if (r.esbuildIssues?.length) {
    console.log("      esbuild issues:");
    for (const i of r.esbuildIssues.slice(0, 8)) console.log(`        - ${i}`);
    if (r.esbuildIssues.length > 8) console.log(`        … (${r.esbuildIssues.length - 8} more)`);
  }
  if (r.notes) console.log(`      note: ${r.notes}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const apps = args.app ? GOLDEN_APPS.filter((a) => a.id === args.app) : GOLDEN_APPS;
  if (apps.length === 0) {
    console.error(
      `No app matched --app=${args.app}. Known ids: ${GOLDEN_APPS.map((a) => a.id).join(", ")}`,
    );
    process.exit(2);
  }

  console.log(`[golden] running ${apps.length} app(s)…\n`);
  const records: RunRecord[] = [];
  for (const app of apps) {
    const rec = await runOne(app);
    records.push(rec);
    const symbol =
      rec.status === "passed" ? "✓" : rec.status === "failed" ? "✗" : "·";
    const line = `  ${symbol} ${rec.id.padEnd(18)} ${rec.status.padEnd(8)} (${rec.durationMs}ms)`;
    console.log(line);
    if (rec.status === "failed") reportFailure(rec);
  }

  const passed = records.filter((r) => r.status === "passed").length;
  const failed = records.filter((r) => r.status === "failed").length;
  const skipped = records.filter((r) => r.status === "skipped").length;
  console.log(
    `\n[golden] ${records.length} apps — ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );

  const exitCode =
    failed > 0 ? 1 : args.strict && skipped > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[golden] runner crashed:", err);
  process.exit(2);
});
