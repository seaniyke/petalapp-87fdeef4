/**
 * WRITE stage — the ONLY writer of first-build pages.
 *
 * Input: the plan (every page + its file). The shell call has already run.
 * Here each planned page is written by ONE focused call (in parallel), then
 * the router is written once only if it doesn't register every page. A page
 * still missing after that gets exactly one more attempt
 * (RECOVERY_LIMITS.missing_page). Finished pages are never rewritten.
 *
 * Nothing else may create pages: cleanup, completeness, design fixes and
 * memory are all non-generative for pages.
 */
import type { ProjectFile } from "@/server/generate.server";
import { assessCompleteness, isPlaceholderFile } from "@/server/engine/build-state";
import type { RecoveryBudget } from "@/server/engine/recovery-policy";
import type { PlannedPage } from "@/server/engine/plan";

export interface WriteResult {
  files: ProjectFile[];
  /** Page/router files this stage wrote. */
  written: string[];
  /** Planned routes whose page is still missing. */
  missing: string[];
  calls: number;
}

export function pageInstruction(page: PlannedPage, deliveredPaths: string[]): string {
  return [
    `Write ONLY the page for route "${page.route}" as ${page.file} (default export). One file in this call — nothing else.`,
    "Make it a complete, polished page with real content, using the existing design system, brand and shared components. Put every section of this page inline in this ONE file — do not create new component, style or config files.",
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].join("\n");
}

export function routerInstruction(pages: PlannedPage[], deliveredPaths: string[]): string {
  return [
    "Write ONLY src/App.tsx. One file in this call — nothing else.",
    `It must route exactly these pages: ${pages.map((p) => `"${p.route}" -> ${p.file}`).join(", ")}.`,
    "Wrap every route in the shared layout (existing header/nav and footer components) so every page is reachable from the navigation.",
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].join("\n");
}

/** The file a WRITE call is asked for (used to keep only that file). */
export function targetOf(instruction: string): string | null {
  return /as (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1] ?? (/ONLY src\/App\.tsx/.test(instruction) ? "src/App.tsx" : null);
}

function hasRealPage(files: ProjectFile[], file: string): boolean {
  const f = files.find((x) => x.path === file);
  return Boolean(f && f.content.trim().length > 0 && !isPlaceholderFile(f.content));
}

export async function writePlannedPages(args: {
  pages: PlannedPage[];
  files: ProjectFile[];
  budget: RecoveryBudget;
  /** One model call; returns the files it wrote, or null on failure. */
  request: (instruction: string) => Promise<ProjectFile[] | null>;
}): Promise<WriteResult> {
  let files = args.files;
  const written: string[] = [];
  let calls = 0;
  const call = async (instruction: string): Promise<ProjectFile[]> => {
    calls++;
    const want = targetOf(instruction);
    try {
      return ((await args.request(instruction)) ?? []).filter((f) => f.path === want);
    } catch {
      return [];
    }
  };
  const put = (got: ProjectFile[]) => {
    for (const f of got) {
      // A finished page is never rewritten; the router is the one exception.
      if (f.path !== "src/App.tsx" && hasRealPage(files, f.path)) continue;
      files = [...files.filter((x) => x.path !== f.path), f];
      written.push(f.path);
    }
  };
  const writePages = async (pages: PlannedPage[]) => {
    const paths = files.map((f) => f.path);
    const results = await Promise.all(pages.map((p) => call(pageInstruction(p, paths))));
    results.forEach(put);
  };

  // 1) Every planned page not yet written — one call each, in parallel.
  await writePages(args.pages.filter((p) => !hasRealPage(files, p.file)));

  // 2) One more attempt for pages still missing (the recovery table's limit).
  const retry = args.pages.filter((p) => !hasRealPage(files, p.file) && args.budget.take("missing_page", p.route));
  if (retry.length) await writePages(retry);

  // 3) Router, once, only if the planned routes aren't all registered.
  // Judge registration only for pages that exist — a missing page is not a
  // router problem and must not trigger a router call.
  const routes = args.pages.filter((p) => hasRealPage(files, p.file)).map((p) => p.route);
  if (routes.length && !assessCompleteness({ requestedRoutes: routes, files }).complete && args.budget.take("missing_page", "app shell")) {
    put(await call(routerInstruction(args.pages, files.map((f) => f.path))));
  }

  const missing = args.pages.filter((p) => !hasRealPage(files, p.file)).map((p) => p.route);
  return { files, written, missing, calls };
}
