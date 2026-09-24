/**
 * COMPLETENESS stage. After generation, application code (never the model)
 * checks that every requested page exists. Each missing page gets ONE
 * focused call that writes only that page (calls run in parallel), then —
 * only if the router is missing routes — ONE call that writes src/App.tsx.
 * Completed pages are never rewritten (mergeChunk protects them).
 *
 * Why per page: live runs showed the model writes one page per reply and
 * defers the rest ("ready for the remaining pages"), whatever the prompt
 * says. Bounded by the requested page list, never a retry loop.
 *
 * Limit: RECOVERY_LIMITS.missing_page (1) per page and for the router. If
 * pages are still missing after that, the caller reports the build as
 * incomplete.
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
  calls: number;
}

export function pageFileFor(route: string): string {
  const seg = route.replace(/^\//, "").split("/")[0] || "home";
  const name = seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return `src/pages/${name}.tsx`;
}

export function pageInstruction(route: string, deliveredPaths: string[]): string {
  return [
    `Write ONLY the page for route "${route}" as ${pageFileFor(route)} (default export). One file in this call — nothing else.`,
    "Make it a complete, polished page with real content, using the existing design system, brand and shared components. Put every section of this page inline in this ONE file — do not create new component, style or config files.",
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].join("\n");
}

export function routerInstruction(routes: string[], deliveredPaths: string[]): string {
  return [
    "Write ONLY src/App.tsx. One file in this call — nothing else.",
    `It must route exactly these pages: ${routes.map((r) => `"${r}" -> ${pageFileFor(r)}`).join(", ")}.`,
    "Wrap every route in the shared layout (existing header/nav and footer components) so every page is reachable from the navigation.",
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].join("\n");
}

/** @deprecated kept for callers/tests that name all pages at once. */
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
  const base = { files: args.files, added: 0, missingBefore: before.missingRoutes, calls: 0 };
  if (before.complete) return { ...base, attempted: false, missingAfter: before.missingRoutes };
  const call = async (instruction: string) => {
    try {
      return (await args.request(instruction)) ?? [];
    } catch {
      return [];
    }
  };
  let calls = 0;
  let files = args.files;
  let added = 0;
  const merge = (written: ProjectFile[]) => {
    if (!written.length) return;
    const m = mergeChunk({ ops: [], files }, { files: written });
    files = m.files;
    added += m.added;
  };

  // 1) Missing pages, one focused call each, in parallel.
  const paths = files.map((f) => f.path);
  const pages = before.missingRoutes.filter((r) => r !== "app shell" && args.budget.take("missing_page", r));
  calls += pages.length;
  const results = await Promise.all(
    pages.map(async (r) => {
      const want = pageFileFor(r);
      // Keep only the page this call was asked for.
      return (await call(pageInstruction(r, paths))).filter((f) => f.path === want);
    }),
  );
  for (const w of results) merge(w);

  // 2) Router, once, only if routes are still unlinked.
  const mid = assessCompleteness({ requestedRoutes: args.requestedRoutes, files });
  if (!mid.complete && args.budget.take("missing_page", "app shell")) {
    calls++;
    const written = (await call(routerInstruction(args.requestedRoutes, files.map((f) => f.path)))).filter((f) =>
      /^src\/App\.(t|j)sx?$/.test(f.path),
    );
    if (written.length) {
      // The router is the one file this step may replace.
      files = [...files.filter((f) => !/^src\/App\.(t|j)sx?$/.test(f.path)), ...written];
      added += written.length;
    }
  }

  const after = assessCompleteness({ requestedRoutes: args.requestedRoutes, files });
  return { files, added, attempted: calls > 0, missingBefore: before.missingRoutes, missingAfter: after.missingRoutes, calls };
}
