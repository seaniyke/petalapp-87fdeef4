/**
 * COMPLETENESS stage. After generation, application code (never the model)
 * checks that every requested page exists. Missing pages are written in ONE
 * call that names every one of them — never page-by-page rounds — and
 * completed pages are never rewritten (mergeChunk protects them).
 *
 * Limit: RECOVERY_LIMITS.missing_page (1). If pages are still missing after
 * that, the caller reports the build as incomplete.
 */
import type { ProjectFile } from "@/server/generate.server";
import { mergeChunk } from "@/server/chunked-generation.server";
import { assessCompleteness } from "@/server/engine/build-state";
import type { RecoveryBudget } from "@/server/engine/recovery-policy";

export interface MissingPagesResult {
  files: ProjectFile[];
  added: number;
  attempted: boolean;
  missingBefore: string[];
  missingAfter: string[];
}

export function missingPagesInstruction(missingRoutes: string[], deliveredPaths: string[]): string {
  const pages = missingRoutes.filter((r) => r !== "app shell");
  const needsShell = missingRoutes.includes("app shell");
  return [
    "The app is not finished. Call write_project now with ONLY the missing pieces below — all of them in this one call.",
    pages.length
      ? `Missing pages (write every one): ${pages.map((r) => `"${r}"`).join(", ")}. Each needs its own file under src/pages/ and a <Route> in src/App.tsx.`
      : "",
    needsShell || pages.length
      ? "Include src/App.tsx with routes for EVERY page (existing and new), keeping the existing layout, header and footer unchanged."
      : "",
    `Already written — do NOT rewrite: ${deliveredPaths.filter((p) => !/src\/App\.(t|j)sx?$/.test(p)).join(", ") || "none"}.`,
    "Use the same design system, brand and components as the existing pages. No extra pages beyond those listed.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateMissingPages(args: {
  requestedRoutes: string[];
  files: ProjectFile[];
  budget: RecoveryBudget;
  /** One model call; returns the files it wrote, or null on failure. */
  request: (instruction: string) => Promise<ProjectFile[] | null>;
}): Promise<MissingPagesResult> {
  const before = assessCompleteness({ requestedRoutes: args.requestedRoutes, files: args.files });
  const base = { files: args.files, added: 0, missingBefore: before.missingRoutes };
  if (before.complete || !args.budget.take("missing_page")) {
    return { ...base, attempted: false, missingAfter: before.missingRoutes };
  }
  const instruction = missingPagesInstruction(
    before.missingRoutes,
    args.files.map((f) => f.path),
  );
  let written: ProjectFile[] | null = null;
  try {
    written = await args.request(instruction);
  } catch {
    written = null;
  }
  if (!written?.length) return { ...base, attempted: true, missingAfter: before.missingRoutes };
  const merged = mergeChunk({ ops: [], files: args.files }, { files: written });
  const after = assessCompleteness({ requestedRoutes: args.requestedRoutes, files: merged.files });
  return {
    files: merged.files,
    added: merged.added,
    attempted: true,
    missingBefore: before.missingRoutes,
    missingAfter: after.missingRoutes,
  };
}
