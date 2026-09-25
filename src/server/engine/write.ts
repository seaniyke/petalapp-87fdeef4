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
  /** Candidates discarded because they were cut off mid-file. */
  truncated: string[];
}

/** The project's real technical substrate, handed to every writer so it
 *  never invents packages, primitives or routing APIs. Deterministic. */
export function projectContract(files: ProjectFile[]): string {
  let deps: string[] = [];
  try {
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")?.content ?? "{}");
    deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).sort();
  } catch { deps = []; }
  const ui = files
    .map((f) => /^src\/components\/ui\/([^/]+)\.tsx$/.exec(f.path)?.[1])
    .filter((x): x is string => !!x)
    .sort();
  const hasRouter = files.some((f) => f.path === "src/components/ui/router.tsx");
  return [
    `Installed packages (import ONLY these, nothing else): ${deps.join(", ") || "none listed"}.`,
    ui.length ? `UI primitives available at @/components/ui/<name>: ${ui.join(", ")}. Do not import any other @/components/ui path.` : "",
    hasRouter ? `Routing: import Link/NavLink/Routes/Route/useLocation from "@/components/ui/router" — never from "react-router-dom".` : "",
    "Icons: lucide-react only, and import every icon you use. Page titles/meta: set document.title in an effect — no helmet libraries.",
  ].filter(Boolean).join("\n");
}

/** Files owned by the shared frame — page calls never write these. */
export function sharedFiles(files: ProjectFile[], pages: PlannedPage[]): string[] {
  const pageFiles = new Set(pages.map((p) => p.file));
  return files
    .map((f) => f.path)
    .filter((p) => !pageFiles.has(p) && (p === "src/App.tsx" || p === "src/styles.css" || p === "index.html" || p === "package.json" || /^src\/components\/(sections|layout|brand)/.test(p) || /brand-mark|nav|header|footer/i.test(p)));
}

export function pageInstruction(page: PlannedPage, deliveredPaths: string[], contract = "", shared: string[] = []): string {
  return [
    `You are writing the "${page.route}" page ONLY.`,
    `WRITE SCOPE: exactly one file — write the page as ${page.file} (default export). Nothing else.`,
    `READ SCOPE: the existing project files listed below. The shared frame (layout, header, footer, colours, logo, router, package.json) already exists and is owned by the frame — do NOT recreate, restyle or modify it${shared.length ? ` (${shared.join(", ")})` : ""}. The page renders inside that frame, so do not add its own header or footer.`,
    "Make it a complete, polished page with real content, using the existing design system and brand. Put every section of this page inline in this ONE file — do not create new component, style or config files.",
    contract,
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].filter(Boolean).join("\n");
}

export function routerInstruction(pages: PlannedPage[], deliveredPaths: string[], contract = ""): string {
  return [
    "You own the SHARED FRAME. Write ONLY src/App.tsx. One file in this call — nothing else.",
    `It must route exactly these pages: ${pages.map((p) => `"${p.route}" -> ${p.file}`).join(", ")}.`,
    "It must contain the shared layout every page renders inside: a header with the brand and navigation to every page, and a footer. Use existing header/nav/footer components from the list below if present; otherwise define them inside src/App.tsx.",
    contract,
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].filter(Boolean).join("\n");
}

/** Deterministic frame check: the app file exists and carries a layout
 *  (navigation + footer), plus a router when there is more than one page.
 *  A one-page site has nothing to route between. Colours and package.json
 *  alone are not a frame. */
export function frameIsComplete(files: ProjectFile[], pageCount = 2): boolean {
  const app = files.find((f) => f.path === "src/App.tsx")?.content ?? "";
  if (!app.trim() || isPlaceholderFile(app)) return false;
  const routed = pageCount <= 1 || /<Routes\b|createBrowserRouter|<Route\b/.test(app);
  return routed && /nav|header/i.test(app) && /footer/i.test(app);
}

/** The file a WRITE call is asked for (used to keep only that file). */
export function targetOf(instruction: string): string | null {
  return /as (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1] ?? (/ONLY src\/App\.tsx/.test(instruction) ? "src/App.tsx" : null);
}

function hasRealPage(files: ProjectFile[], file: string): boolean {
  const f = files.find((x) => x.path === file);
  return Boolean(f && f.content.trim().length > 0 && !isPlaceholderFile(f.content));
}

/**
 * Output-limit continuation input: pages the shell's OWN router already
 * imports (`@/pages/X`) that don't exist yet. When the shell call runs out
 * of output room — or the planner under-counted the pages — this is the
 * concrete record of what remains unfinished, so the WRITE stage writes
 * exactly those pages instead of leaving a router pointing at nothing.
 * Deterministic; never invents a page the router doesn't reference.
 */
export function pagesReferencedByRouter(files: ProjectFile[], known: PlannedPage[]): PlannedPage[] {
  const app = files.find((f) => f.path === "src/App.tsx")?.content ?? "";
  const knownFiles = new Set(known.map((p) => p.file));
  const out: PlannedPage[] = [];
  for (const m of app.matchAll(/from\s+["']@\/pages\/([A-Za-z][\w-]*)(?:\.tsx)?["']/g)) {
    const name = m[1]!;
    const file = `src/pages/${name}.tsx`;
    if (knownFiles.has(file) || hasRealPage(files, file)) continue;
    knownFiles.add(file);
    const slug = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    out.push({ route: /^(home|index|landing)$/.test(slug) ? "/" : `/${slug}`, file });
  }
  return out;
}

export async function writePlannedPages(args: {
  pages: PlannedPage[];
  files: ProjectFile[];
  budget: RecoveryBudget;
  /** One model call; returns the files it wrote, or null on failure. */
  request: (instruction: string) => Promise<ProjectFile[] | null>;
  /** Structural check: true when a candidate was cut off mid-file. A
   *  truncated candidate is discarded (never patched), which leaves the page
   *  missing so step 2 re-requests that same file exactly once. */
  isTruncated?: (file: ProjectFile) => Promise<boolean>;
}): Promise<WriteResult> {
  let files = args.files;
  const written: string[] = [];
  const truncated: string[] = [];
  let calls = 0;
  const call = async (instruction: string): Promise<ProjectFile[]> => {
    calls++;
    const want = targetOf(instruction);
    try {
      const got = ((await args.request(instruction)) ?? []).filter((f) => f.path === want);
      if (!args.isTruncated) return got;
      const whole: ProjectFile[] = [];
      for (const f of got) {
        let cut = false;
        try { cut = await args.isTruncated(f); } catch { cut = false; }
        if (cut) truncated.push(f.path);
        else whole.push(f);
      }
      return whole;
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
    const contract = projectContract(files);
    const shared = sharedFiles(files, args.pages);
    const results = await Promise.all(pages.map((p) => call(pageInstruction(p, paths, contract, shared))));
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
  // The frame is authoritative: it runs when the router is incomplete OR
  // the shell call didn't deliver a real layout (colours alone aren't one).
  const needFrame = !frameIsComplete(files, args.pages.length) || (routes.length > 0 && !assessCompleteness({ requestedRoutes: routes, files }).complete);
  if (needFrame && args.budget.take("missing_page", "app shell")) {
    put(await call(routerInstruction(args.pages, files.map((f) => f.path), projectContract(files))));
  }

  const missing = args.pages.filter((p) => !hasRealPage(files, p.file)).map((p) => p.route);
  return { files, written, missing, calls, truncated };
}
