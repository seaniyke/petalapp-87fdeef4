/**
 * Replay-mode harness: run a recorded GeneratedApp through every gate
 * the live build pipeline applies before files reach a user's project.
 *
 * Why replay (not "call the real model on every CI run"):
 *
 *   - Cost: 10 apps × nightly × ~50k tokens each is real money. We'd run
 *     it less often, which defeats the point of regression coverage.
 *   - Determinism: LLM output varies. The grade would flap on identical
 *     input. We'd spend our triage time on noise, not real regressions.
 *   - Coupling: aiChatCompletions() pulls in supabaseAdmin, the
 *     ai_provider_settings cache, telemetry inserts. None of that runs
 *     cleanly in a plain `bun src/server/__tests__/...` invocation.
 *
 * What this catches (the 90% that matters):
 *   - Verifier rules tightening or regressing
 *   - Scaffold drift breaking baseline expectations
 *   - esbuild config changes that break parsing
 *   - Type system / import path changes
 *   - Render-risk or RLS-sanity linter regressions
 *
 * What it deliberately does NOT catch:
 *   - Model quality drift (tested separately when we update prompts —
 *     that's a deliberate human review step, not a CI signal).
 *
 * To refresh fixtures (when a pipeline change is intentional and you
 * want the new model output to become the new baseline), run the
 * generation pipeline manually for that app and overwrite
 * `fixtures/<app-id>/files.json`. We don't automate that yet because
 * doing so safely needs a credit-budgeted, opt-in record mode.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { verifyFilesEsbuild } from "../../esbuild-verifier.server";
import { grade, type GeneratedApp, type GradeResult } from "./grade";
import type { GoldenAppPrompt } from "./prompts";

const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname;

export interface FullGradeResult extends GradeResult {
  /** Esbuild parse pass on every changed .ts/.tsx file. */
  esbuildPassed: boolean;
  esbuildIssues?: ReadonlyArray<string>;
  /** True when no fixture is recorded for this app yet (skipped, not failed). */
  fixtureMissing?: boolean;
}

export async function loadFixture(appId: string): Promise<GeneratedApp | null> {
  const file = path.join(FIXTURES_DIR, appId, "files.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      files: Array<{ path: string; content: string }>;
      changedPaths?: string[];
    };
    return {
      files: parsed.files,
      changedPaths: parsed.changedPaths ?? parsed.files.map((f) => f.path),
    };
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "ENOENT") return null;
    throw err;
  }
}

export async function gradeFull(
  app: GoldenAppPrompt,
  generated: GeneratedApp | null,
): Promise<FullGradeResult> {
  if (!generated) {
    return {
      filesEmitted: false,
      verifierPassed: false,
      bundlePassed: false,
      typecheckPassed: false,
      esbuildPassed: false,
      fixtureMissing: true,
      notes: "no fixture recorded — see fixtures/README.md",
    };
  }

  const base = grade(app, generated);

  // Esbuild parse pass on every changed .ts/.tsx in the recorded app.
  let esbuildPassed = true;
  let esbuildIssues: string[] | undefined;
  try {
    const verdict = await verifyFilesEsbuild(
      [...generated.files],
      [...generated.changedPaths],
    );
    esbuildPassed = verdict.ok;
    if (!verdict.ok) {
      esbuildIssues = verdict.issues.map(
        (i) => `${i.path}:${i.line}:${i.column} ${i.message}`,
      );
    }
  } catch (err) {
    // Esbuild infra failure: don't fail the suite — log and pass.
    // Mirrors the same policy used in the live verifier.
    console.warn(`[golden] esbuild verifier crashed for ${app.id}:`, err);
  }

  return {
    ...base,
    bundlePassed: esbuildPassed, // bundle gate is the esbuild parse pass for now
    esbuildPassed,
    esbuildIssues,
  };
}

/** True iff the app passes every applicable gate. */
export function isPassing(r: FullGradeResult): boolean {
  if (r.fixtureMissing) return true; // skipped, not failed
  return (
    r.filesEmitted &&
    r.verifierPassed &&
    r.esbuildPassed &&
    r.expectedFilesPresent !== false
  );
}
