/**
 * Petal v3 — Phase B: write-time validation.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The old contract was: the model emits whole files, everything is written,
 * and ~30 ordered repair passes try to make the result valid afterwards. A
 * file that does not parse still landed in the project, and the user found out
 * when the remote build failed minutes later.
 *
 * This gate flips that. Every file a turn touches is esbuild-parsed AT WRITE
 * TIME. A file that does not parse gets one deterministic per-file heal (the
 * four pure syntax passes — fences, literal escapes, malformed imports,
 * unbraced JSX attributes). If it still does not parse, the write is REJECTED:
 * the path reverts to its previous bytes (or disappears entirely if it was
 * new), and the exact line/column diagnostic is handed back to the model.
 *
 * Contract:
 *   - Never ships a source file that cannot be parsed.
 *   - Never leaves a half-written project: rejection reverts, it does not
 *     blank.
 *   - Never throws. If esbuild itself is unavailable, everything is accepted
 *     and the later pre-emit gate remains the backstop.
 *   - Scaffold-owned paths are exempt — Petal wrote them, the model can't fix
 *     them, and reverting them would undo a deterministic repair.
 */

import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { fixMarkdownFences } from "@/server/markdown-fence-fixer.server";
import { fixSourceEscapes } from "@/server/source-escape-fixer.server";
import { fixImportSyntax } from "@/server/import-syntax-fixer.server";
import { fixJsxAttrLiterals } from "@/server/jsx-attr-literal-fixer.server";
import { isVerifierExempt } from "@/server/scaffold-ownership.server";
import type { ProjectFile } from "@/server/generate.server";

export interface WriteRejection {
  path: string;
  /** esbuild's message, including line:column when it gave us one. */
  detail: string;
  /** True when the path existed before this turn and was rolled back. */
  reverted: boolean;
}

export interface WriteGateResult {
  /** Project state with every unparseable write rolled back. */
  files: ProjectFile[];
  /** Files that were healed in place and then parsed clean. */
  healedPaths: string[];
  /** Writes that were refused. Empty means everything landed. */
  rejected: WriteRejection[];
}

const PARSEABLE = /\.(tsx?|jsx?|mts|cts)$/i;

function parseCandidates(changedPaths: string[]): string[] {
  return changedPaths.filter((p) => PARSEABLE.test(p) && !isVerifierExempt(p));
}

/** The four pure, per-file syntax passes. Order matches `runAllRepairs`. */
function healOne(file: ProjectFile): ProjectFile {
  let out = [file];
  out = fixMarkdownFences(out).files;
  out = fixSourceEscapes(out).files;
  out = fixImportSyntax(out).files;
  out = fixJsxAttrLiterals(out).files;
  // Escape decoding can reveal a fence that arrived as literal `\n` bytes.
  out = fixMarkdownFences(out).files;
  return out[0] ?? file;
}

async function failingPaths(
  files: ProjectFile[],
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  try {
    const verdict = await verifyFilesEsbuild(files, paths);
    for (const issue of verdict.issues) {
      if (out.has(issue.path)) continue;
      out.set(issue.path, `${issue.message} (line ${issue.line}:${issue.column})`);
    }
  } catch (e) {
    // Infra failure must never fail a turn that would otherwise ship.
    console.warn("[write-gate] esbuild unavailable, accepting all writes:", e);
    return new Map();
  }
  return out;
}

/**
 * Validate this turn's writes.
 *
 * @param before       Project state as it was before the ops were applied.
 * @param after        Project state after the ops were applied.
 * @param changedPaths Paths the turn touched (from `diffChangedPaths`).
 */
export async function runWriteGate(args: {
  before: ProjectFile[];
  after: ProjectFile[];
  changedPaths: string[];
}): Promise<WriteGateResult> {
  const candidates = parseCandidates(args.changedPaths);
  if (candidates.length === 0) {
    return { files: args.after, healedPaths: [], rejected: [] };
  }

  const firstPass = await failingPaths(args.after, candidates);
  if (firstPass.size === 0) {
    return { files: args.after, healedPaths: [], rejected: [] };
  }

  // Round 1 — deterministic per-file heal for the failures only.
  const byPath = new Map(args.after.map((f) => [f.path, f.content]));
  const healedPaths: string[] = [];
  for (const path of firstPass.keys()) {
    const content = byPath.get(path);
    if (content === undefined) continue;
    const healed = healOne({ path, content });
    if (healed.content !== content) {
      byPath.set(path, healed.content);
      healedPaths.push(path);
    }
  }

  let files = Array.from(byPath, ([path, content]) => ({ path, content }));
  const stillFailing = await failingPaths(files, Array.from(firstPass.keys()));

  // Anything the heal fixed is no longer a rejection.
  const actuallyHealed = healedPaths.filter((p) => !stillFailing.has(p));

  if (stillFailing.size === 0) {
    return { files, healedPaths: actuallyHealed, rejected: [] };
  }

  // Round 2 — refuse the write. Revert to the pre-turn bytes so the project
  // is never left holding a file that cannot be parsed.
  const beforeByPath = new Map(args.before.map((f) => [f.path, f.content]));
  const rejected: WriteRejection[] = [];
  for (const [path, detail] of stillFailing) {
    const prior = beforeByPath.get(path);
    if (prior === undefined) {
      byPath.delete(path);
      rejected.push({ path, detail, reverted: false });
    } else {
      byPath.set(path, prior);
      rejected.push({ path, detail, reverted: true });
    }
  }

  files = Array.from(byPath, ([path, content]) => ({ path, content }));
  return { files, healedPaths: actuallyHealed, rejected };
}

/** Model-facing diagnostic: exactly what broke and what to do about it. */
export function formatWriteGateFeedback(rejections: WriteRejection[]): string {
  return rejections
    .slice(0, 8)
    .map(
      (r) =>
        `- ${r.path} — ${r.detail}${r.reverted ? " (rolled back to the previous version)" : " (not written)"}`,
    )
    .join("\n");
}

/** One-line-per-rejection note for the end-of-turn summary. */
export function writeGateDisclosure(rejections: WriteRejection[]): string {
  if (rejections.length === 0) return "";
  const lines = rejections.map((r) => `- \`${r.path}\` — ${r.detail}`);
  return [
    "",
    rejections.length === 1
      ? "**One file didn't parse, so I didn't write it:**"
      : `**${rejections.length} files didn't parse, so I didn't write them:**`,
    ...lines,
    "",
    "Everything else landed and your app is still in a working state. Say the word and I'll retry the rejected part.",
  ].join("\n");
}
