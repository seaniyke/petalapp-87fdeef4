/**
 * Staged Pipeline — Stage 3: WIRE-UP
 *
 * Runs the parallel-scaffold output through the same deterministic
 * verifiers the monolithic path uses, then through ensureRenderableShell
 * so the entry trio (index.html, src/main.tsx, src/App.tsx) is always
 * present.
 *
 * Returns:
 *   - ok:true with files when everything passed.
 *   - ok:false reason="missing_root_view" when the model produced no real
 *     src/App.tsx — the orchestrator turns this into a silent fallback
 *     to the monolithic path so the user still gets a real app this turn.
 *   - ok:false reason="local_verifier_fatal" / "esbuild_parse_failed"
 *     for unfixable parse errors.
 */

import { verifyFilesLocal } from "@/server/local-verifier";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { ensureRenderableShell } from "@/server/renderable-shell.server";
import { fixMissingShadcnImports } from "@/server/shadcn-imports.server";
import type { ProjectFile } from "@/server/generate.server";

export interface StageWireupResult {
  ok: true;
  files: ProjectFile[];
  summary: string;
  notes: string[];
}

export interface StageWireupFailure {
  ok: false;
  reason: string;
  blockingIssues: string[];
}

export async function runStageWireup(args: {
  files: ProjectFile[];
  brief: string;
}): Promise<StageWireupResult | StageWireupFailure> {
  let files = args.files;
  const notes: string[] = [];

  // 0. Deterministic shadcn missing-import autofix. Catches the
  // "Can't find variable: AvatarImage" class of runtime crashes that
  // pass TS-loose JSX but blow up at render. Runs BEFORE the verifier
  // so the "undefined" issue disappears before we judge fatal-ness.
  const shadcnFix = fixMissingShadcnImports(files);
  files = shadcnFix.files;
  if (shadcnFix.fixes.length > 0) {
    const totalAdded = shadcnFix.fixes.reduce((n, f) => n + f.added.length, 0);
    notes.push(
      `shadcn-imports: injected ${totalAdded} missing import(s) across ${shadcnFix.fixes.length} file(s)`,
    );
  }

  const allPaths = files.map((f) => f.path);

  // 1. Local verifier — parse + imports + exports.
  const localVerdict = verifyFilesLocal(files, allPaths);
  if (!localVerdict.ok) {
    const fatal = localVerdict.issues.filter(
      (i) =>
        i.kind === "truncation" ||
        i.kind === "unterminated-string" ||
        i.kind === "braces" ||
        // Undefined components survived the shadcn autofix — they will
        // crash at render. Fail the stage so the orchestrator falls back
        // to the monolithic path (which has continuation + model autofix).
        i.kind === "undefined",
    );
    if (fatal.length > 0) {
      return {
        ok: false,
        reason: fatal.some((i) => i.kind === "undefined")
          ? "undefined_components"
          : "local_verifier_fatal",
        blockingIssues: fatal.map((i) => `${i.path}: ${i.kind} — ${i.detail ?? ""}`).slice(0, 8),
      };
    }
    notes.push(
      `local-verifier: ${localVerdict.issues.length} non-fatal issue(s) deferred to autofix`,
    );
  }

  // 2. Esbuild verifier — real parser.
  try {
    const esbuildVerdict = await verifyFilesEsbuild(args.files, allPaths);
    if (!esbuildVerdict.ok) {
      return {
        ok: false,
        reason: "esbuild_parse_failed",
        blockingIssues: esbuildVerdict.issues
          .map((i) => `${i.path}:${i.line}:${i.column} — ${i.message}`)
          .slice(0, 8),
      };
    }
  } catch (e) {
    notes.push(`esbuild-verifier threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Entry trio + root view. index.html / src/main.tsx are safe to inject
  // unconditionally — Petal owns them. src/App.tsx is the contract: if the
  // model produced no real root view, we MUST fail the stage so the
  // orchestrator falls back to the monolithic path (which has its own
  // retry/continuation budget) instead of shipping the placeholder.
  const shell = ensureRenderableShell(args.files);
  if (shell.degraded.includes("src/App.tsx")) {
    return {
      ok: false,
      reason: "missing_root_view",
      blockingIssues: ["src/App.tsx was empty or a placeholder — falling back to monolithic path"],
    };
  }

  if (shell.fixed.length > 0) {
    notes.push(`renderable-shell repaired: ${shell.fixed.join(", ")}`);
  }

  return {
    ok: true,
    files: shell.files,
    summary: `Built ${shell.files.length} file${shell.files.length === 1 ? "" : "s"} for: ${args.brief.slice(0, 80)}`,
    notes,
  };
}
