/**
 * File-budget gate — Tier 2.4 of the build pipeline.
 *
 * The 180-line / 6 KB cap used to be a prompt rule. The model "should"
 * respect it but had no consequences when it didn't, so once or twice a
 * day a turn would emit a 400-line page that truncated mid-stream and
 * burned the autofix budget trying to recover from it.
 *
 * This module makes the cap real, server-side:
 *
 *   - Healthy        ≤ 180 lines AND ≤  6 KB → pass through
 *   - Oversize       181-280 lines OR  6-10 KB → warn (autofix asked to split)
 *   - Hard reject    > 280 lines OR > 10 KB → revert to prior content
 *
 * Hard rejections are routed into the Layer-B "Continue building" handoff
 * (see /api/generate.ts).
 */

export const MAX_FILE_LINES = 180;
export const MAX_FILE_BYTES = 6 * 1024;
export const HARD_REJECT_LINES = 280;
export const HARD_REJECT_BYTES = 10 * 1024;

export type FileBudgetIssue = {
  path: string;
  lines: number;
  bytes: number;
  severity: "warn" | "reject";
  /** Friendly message suitable for both logs and AI prompts. */
  detail: string;
};

export type FileBudgetVerdict = {
  warnings: FileBudgetIssue[];
  rejections: FileBudgetIssue[];
};

const SCANNABLE = /\.(tsx?|jsx?)$/;

function shouldSkip(path: string): boolean {
  if (!SCANNABLE.test(path)) return true;
  // Mirror the local-verifier skip list — these are scaffold-managed.
  if (path.startsWith("src/components/ui/")) return true;
  if (path.startsWith("src/integrations/")) return true;
  if (path.startsWith("src/components/examples/")) return true;
  return false;
}

function countLines(content: string): number {
  if (!content) return 0;
  // Count newline-separated lines; final missing newline still counts.
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) n++;
  }
  return n;
}

function byteLength(content: string): number {
  // TextEncoder is available in the Worker runtime.
  return new TextEncoder().encode(content).byteLength;
}

export function checkFileBudgets(
  files: { path: string; content: string }[],
  changedPaths: string[],
): FileBudgetVerdict {
  const changed = new Set(changedPaths);
  const warnings: FileBudgetIssue[] = [];
  const rejections: FileBudgetIssue[] = [];

  for (const f of files) {
    if (!changed.has(f.path)) continue;
    if (shouldSkip(f.path)) continue;

    const lines = countLines(f.content);
    const bytes = byteLength(f.content);

    const overHardLines = lines > HARD_REJECT_LINES;
    const overHardBytes = bytes > HARD_REJECT_BYTES;
    if (overHardLines || overHardBytes) {
      rejections.push({
        path: f.path,
        lines,
        bytes,
        severity: "reject",
        detail: `${f.path} is ${lines} lines / ${(bytes / 1024).toFixed(1)} KB — too large to ship safely`,
      });
      continue;
    }

    const overSoftLines = lines > MAX_FILE_LINES;
    const overSoftBytes = bytes > MAX_FILE_BYTES;
    if (overSoftLines || overSoftBytes) {
      warnings.push({
        path: f.path,
        lines,
        bytes,
        severity: "warn",
        detail: `${f.path} is ${lines} lines / ${(bytes / 1024).toFixed(1)} KB — split into smaller sub-components (Hero, Features, CTA, Footer, etc.) under src/components/`,
      });
    }
  }

  return { warnings, rejections };
}

/**
 * Apply rejections to the file map: revert reverted files to their prior
 * content, drop newly-added rejected files entirely. This guarantees we
 * never SHIP a file > HARD_REJECT_LINES even when the model insists.
 */
export function enforceFileBudgets(
  nextFiles: { path: string; content: string }[],
  priorFiles: { path: string; content: string }[],
  rejections: FileBudgetIssue[],
): { path: string; content: string }[] {
  if (rejections.length === 0) return nextFiles;
  const rejectedPaths = new Set(rejections.map((r) => r.path));
  const priorByPath = new Map(priorFiles.map((f) => [f.path, f.content]));

  const out: { path: string; content: string }[] = [];
  for (const f of nextFiles) {
    if (!rejectedPaths.has(f.path)) {
      out.push(f);
      continue;
    }
    const prior = priorByPath.get(f.path);
    if (prior !== undefined) {
      // Existing file → revert to last-known-good content.
      out.push({ path: f.path, content: prior });
    }
    // New file that was rejected → drop entirely.
  }
  return out;
}

// `buildHandoffPrompt` was removed along with the Continue-building chip.
// File-budget enforcement still runs (oversize files are reverted via
// `enforceFileBudgets`), it just no longer emits a user-facing handoff.

