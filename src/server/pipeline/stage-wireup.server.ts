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
import { runAllRepairs } from "@/server/repair-all.server";
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

  // 0. Single composition point for all deterministic file-graph repairs:
  //    extension normalizer → shadcn imports → array safety →
  //    local import resolver → bare import resolver.
  // Order matters and is enforced inside runAllRepairs. Every pass is pure
  // ProjectFile[] → ProjectFile[], <5ms per file, no I/O.
  const repaired = runAllRepairs(files);
  files = repaired.files;
  notes.push(...repaired.notes);


  const allPaths = files.map((f) => f.path);

  // Petal-owned scaffold files (the kit under src/components/{ui,fx,blocks,
  // mobile,content}) are shipped constants, not model output. Judging them
  // here was rejecting every staged build over regex false positives in code
  // that esbuild parses fine — the whole staged pipeline then silently fell
  // back to the monolithic path on EVERY build. Only verify authored files.
  const isKitFile = (p: string) =>
    /^src\/components\/(ui|fx|blocks|mobile|content)\//.test(p);
  const authored = files.filter((f) => !isKitFile(f.path));

  // 1. Esbuild verifier FIRST — it is the real parser and the only honest
  //    authority on whether a file compiles.
  try {
    const esbuildVerdict = await verifyFilesEsbuild(authored, allPaths);
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

  // 2. Local verifier — imports/exports/undefined components. Its regex-based
  //    syntax kinds (braces / unterminated-string / truncation) are advisory
  //    now that esbuild has already parsed these files successfully.
  const localVerdict = verifyFilesLocal(authored, allPaths);
  if (!localVerdict.ok) {
    const fatal = localVerdict.issues.filter((i) => i.kind === "undefined");
    if (fatal.length > 0) {
      return {
        ok: false,
        reason: "undefined_components",
        blockingIssues: fatal.map((i) => `${i.path}: ${i.kind} — ${i.detail ?? ""}`).slice(0, 8),
      };
    }
    notes.push(
      `local-verifier: ${localVerdict.issues.length} non-fatal issue(s) deferred to autofix`,
    );
  }



  // 3. Entry trio + root view. index.html / src/main.tsx are safe to inject
  // unconditionally — Petal owns them. src/App.tsx is the contract: if the
  // model produced no real root view, we MUST fail the stage so the
  // orchestrator falls back to the monolithic path (which has its own
  // retry/continuation budget) instead of shipping the placeholder.
  const shell = ensureRenderableShell(files);
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
