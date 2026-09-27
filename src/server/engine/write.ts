/**
 * Instruction + workspace-fact helpers used by the agent loop
 * (engine/agent-loop.ts), which is the only executor of build operations.
 * Everything here is deterministic; nothing here calls a model or writes.
 */
import type { ProjectFile } from "@/server/generate.server";
import { isPlaceholderFile } from "@/server/engine/build-state";
import type { PlannedPage } from "@/server/engine/plan";
import type { PageDecision } from "@/server/execution/complexity";

/** Marker the request callback uses to parse a multi-file page answer. */
export const DECOMPOSED_MARKER = "DECOMPOSED PAGE";

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
  const shared = sharedModules(files);
  return [
    `Installed packages (import ONLY these, nothing else): ${deps.join(", ") || "none listed"}.`,
    ui.length ? `UI primitives available at @/components/ui/<name>: ${ui.join(", ")}. Do not import any other @/components/ui path.` : "",
    hasRouter ? `Routing: import Link/NavLink/Routes/Route/useLocation from "@/components/ui/router" — never from "react-router-dom".` : "",
    "Icons: lucide-react only, and import every icon you use. Page titles/meta: set document.title in an effect — no helmet libraries.",
    shared.length
      ? `Shared app modules (foundation) — import app data, auth, hooks and types ONLY from these, using exactly these export names:\n${shared.map((m) => `- @/${m.path.replace(/^src\//, "").replace(/\.(tsx?|jsx?)$/, "")}: ${m.exports.join(", ") || "(default)"}`).join("\n")}\nDo not import any other @/lib, @/hooks, @/contexts, @/data, @/integrations or @/services path. If you need something not listed, define it inside your own file.`
      : "No shared app modules exist yet: do not import from @/lib, @/hooks, @/contexts, @/data, @/integrations or @/services — define what you need inside your own file.",
  ].filter(Boolean).join("\n");
}

/** Foundation modules (data, auth, hooks, types) and their real export names. Deterministic. */
export function sharedModules(files: ProjectFile[]): Array<{ path: string; exports: string[] }> {
  const out: Array<{ path: string; exports: string[] }> = [];
  for (const f of files) {
    if (!/^src\/(lib|hooks|contexts|context|data|services|store|integrations|types)(\/|\.)/.test(f.path)) continue;
    if (!/\.(tsx?|jsx?)$/.test(f.path) || f.path.startsWith("src/integrations/supabase/")) continue;
    const names = new Set<string>();
    for (const m of f.content.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
    for (const m of f.content.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1]!.split(",")) { const k = n.trim().split(/\s+as\s+/).pop()!.trim(); if (k) names.add(k); }
    out.push({ path: f.path, exports: Array.from(names).slice(0, 40) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
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

/**
 * Decomposed page: a page shell that composes section components, each in its
 * own file under the page's section folder. Used only when the complexity
 * decision says one generation is risky — never for simple pages.
 */
export function decomposedPageInstruction(page: PlannedPage, decision: PageDecision, deliveredPaths: string[], contract = "", shared: string[] = []): string {
  return [
    `${DECOMPOSED_MARKER}: You are writing the "${page.route}" page ONLY, split into coherent units.`,
    `WRITE SCOPE: the page file ${page.file} (default export) plus its section components in ${decision.sectionDir}/ (one named-export component per file, PascalCase file names). Nothing else.`,
    `The page file is a thin shell: it imports each section from "@/${decision.sectionDir.replace(/^src\//, "")}/<Name>" and composes them in order. Each section owns one responsibility (e.g. a stats strip, a data table, a form, a detail panel). Put a section's static data inside that section file.`,
    "Only split along real responsibilities — 3 to 6 sections is typical. Do not create one-use wrapper components, hooks, or config files, and do not move shared UI primitives.",
    `READ SCOPE: the existing project files listed below. The shared frame (layout, header, footer, colours, logo, router, package.json) already exists — do NOT recreate or modify it${shared.length ? ` (${shared.join(", ")})` : ""}. The page renders inside that frame, so do not add its own header or footer.`,
    "Make it a complete, polished page with real content, using the existing design system and brand.",
    contract,
    `Existing files you may import (do NOT rewrite them): ${deliveredPaths.join(", ") || "none"}.`,
    "No extra pages.",
  ].filter(Boolean).join("\n");
}

/** One missing section of a decomposed page (continuation after a cut-off). */
export function sectionInstruction(page: PlannedPage, sectionFile: string, pageSource: string, contract = ""): string {
  const name = sectionFile.split("/").pop()!.replace(/\.tsx$/, "");
  return [
    `You are writing ONE section component for the "${page.route}" page.`,
    `WRITE SCOPE: exactly one file — write it as ${sectionFile} exporting \`export function ${name}\`. Nothing else.`,
    "The page shell below already imports and renders it; match how it is used (props, if any).",
    contract,
    `Page shell (${page.file}, do NOT rewrite):\n${pageSource.slice(0, 6000)}`,
  ].filter(Boolean).join("\n");
}

/** Section files a page shell imports from its section folder that don't exist yet. */
export function missingSections(files: ProjectFile[], pageFile: string, sectionDir: string): string[] {
  const src = files.find((f) => f.path === pageFile)?.content ?? "";
  const alias = "@/" + sectionDir.replace(/^src\//, "");
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (!spec.startsWith(alias + "/")) continue;
    const file = `src/${spec.slice(2).replace(/\.tsx$/, "")}.tsx`;
    if (!files.some((f) => f.path === file && f.content.trim()) && !out.includes(file)) out.push(file);
  }
  return out;
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

const NAV_TAG = /<(nav|header)\b/i;
const FOOTER_TAG = /<footer\b/i;
/** A sidebar application frame: complete without a site footer (apps are not marketing sites). */
const APP_SIDEBAR_TAG = /<aside\b/i;

/** Resolve a local import spec ("@/x" or relative) to a file in `byPath`. */
function resolveLocal(from: string, spec: string, byPath: Map<string, string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    base = parts.join("/");
  } else return null;
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]) {
    if (byPath.has(base + ext)) return base + ext;
  }
  return null;
}

/** Local modules whose imported component is actually RENDERED by `src`. */
function renderedImports(path: string, src: string, byPath: Map<string, string>): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const target = resolveLocal(path, m[2]!, byPath);
    if (!target) continue;
    const names = m[1]!
      .replace(/[{}]/g, ",")
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())
      .filter((s) => /^[A-Z]\w*$/.test(s));
    if (names.some((n) => new RegExp(`<${n}\\b|\\bComponent:\\s*${n}\\b`).test(src))) out.push(target);
  }
  return out;
}

/** Deterministic frame check: the app file exists, routes when there is more
 *  than one page, and RENDERS a layout carrying navigation + footer — either
 *  inline in src/App.tsx or in a shared layout component App.tsx imports and
 *  renders (which must in turn render the page content). An unused component
 *  that happens to contain a nav/footer does not count. */
export function frameIsComplete(files: ProjectFile[], pageCount = 2): boolean {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const app = byPath.get("src/App.tsx") ?? "";
  if (!app.trim() || isPlaceholderFile(app)) return false;
  const routed = pageCount <= 1 || /<Routes\b|createBrowserRouter|<Route\b/.test(app);
  if (!routed) return false;
  let nav = NAV_TAG.test(app);
  let footer = FOOTER_TAG.test(app) || APP_SIDEBAR_TAG.test(app);
  const appRoutesInline = /<Routes\b|<Route\b|createBrowserRouter/.test(app) || pageCount <= 1;
  const seen = new Set(["src/App.tsx"]);
  let frontier = [{ path: "src/App.tsx", src: app }];
  for (let depth = 0; depth < 3 && !(nav && footer) && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { path, src } of frontier) {
      for (const t of renderedImports(path, src, byPath)) {
        if (seen.has(t)) continue;
        seen.add(t);
        const c = byPath.get(t) ?? "";
        if (isPlaceholderFile(c)) continue;
        // A layout that wraps pages must render them.
        const wraps = /<Outlet\b|\{\s*(props\.)?children\s*\}/.test(c);
        // Counted when page content flows through it (it wraps an Outlet or
        // children), when App renders <Routes> itself beside it (separate
        // Header/Footer), or when it sits inside such a rendered component.
        const counts = wraps || depth > 0 || appRoutesInline;
        if (counts && NAV_TAG.test(c)) nav = true;
        if (counts && (FOOTER_TAG.test(c) || APP_SIDEBAR_TAG.test(c))) footer = true;
        next.push({ path: t, src: c });
      }
    }
    frontier = next;
  }
  // `footer` = the frame closes the page: a site footer, or a sidebar app frame.
  return nav && footer;
}

/** The file a WRITE call is asked for (used to keep only that file). */
export function targetOf(instruction: string): string | null {
  return /as (src\/(?:pages|components)\/[^\s]+\.tsx)/.exec(instruction)?.[1] ??
    /the page file (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1] ?? (/ONLY src\/App\.tsx/.test(instruction) ? "src/App.tsx" : null);
}

/** Max simultaneous page-writing calls (see writePages). */
export const PAGE_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `limit` in flight; order preserved. */
export async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
