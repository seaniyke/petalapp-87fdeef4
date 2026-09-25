/**
 * Deterministic App Map — derived from the project's CURRENT source only.
 *
 * No AI, no storage, no memory: recomputed from the files every turn so it can
 * never go stale. Current source beats project notes; this block tells the
 * writer and every repair how the app is actually wired (router, entry, pages,
 * layout, navigation) so nobody invents a second routing mechanism.
 */
import type { ProjectFile } from "@/server/generate.server";

export type RouterKind =
  | "kit-router" // "@/components/ui/router" (re-exports react-router-dom)
  | "react-router-dom"
  | "tanstack-router"
  | "wouter"
  | "state-switch" // useState-based page switching
  | "none";

export type AppMapRoute = { path: string; component: string; file: string | null };

export type AppMap = {
  router: RouterKind;
  routerImport: string | null;
  entry: string | null;
  routerFile: string | null;
  routes: AppMapRoute[];
  pages: string[];
  layouts: string[];
  navLinks: string[];
  styles: string[];
  /** Direct local imports per page/layout file (paths as written). */
  deps: Record<string, string[]>;
};

const ROUTER_SPECS: Array<[RouterKind, RegExp]> = [
  ["kit-router", /from\s+["']@\/components\/ui\/router["']/],
  ["tanstack-router", /from\s+["']@tanstack\/react-router["']/],
  ["react-router-dom", /from\s+["']react-router(?:-dom)?["']/],
  ["wouter", /from\s+["']wouter["']/],
];

const SPEC_FOR: Record<RouterKind, string | null> = {
  "kit-router": "@/components/ui/router",
  "react-router-dom": "react-router-dom",
  "tanstack-router": "@tanstack/react-router",
  wouter: "wouter",
  "state-switch": null,
  none: null,
};

function isCode(p: string): boolean {
  return /\.(t|j)sx?$/.test(p) && !p.startsWith("src/components/examples/") && !p.startsWith("src/components/ui/");
}

function localImports(content: string): Array<{ names: string[]; spec: string }> {
  const out: Array<{ names: string[]; spec: string }> = [];
  const re = /import\s+([^'";]+?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const spec = m[2]!;
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
    const names = m[1]!
      .replace(/[{}]/g, " ")
      .split(/[\s,]+/)
      .filter((n) => n && n !== "type" && n !== "as" && n !== "*");
    out.push({ names, spec });
  }
  return out;
}

function resolveSpec(fromPath: string, spec: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else {
    const dir = fromPath.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  }
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]) {
    if (paths.has(base + ext)) return base + ext;
  }
  return null;
}

export function buildAppMap(files: ProjectFile[]): AppMap {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const entry =
    ["src/App.tsx", "src/App.jsx", "src/main.tsx", "src/main.jsx"].find((p) => paths.has(p)) ?? null;

  // Router: prefer what the entry/App file actually imports; fall back to any app file.
  const code = files.filter((f) => isCode(f.path));
  const ordered = entry ? [files.find((f) => f.path === entry)!, ...code] : code;
  let router: RouterKind = "none";
  let routerFile: string | null = null;
  for (const f of ordered) {
    const hit = ROUTER_SPECS.find(([, re]) => re.test(f.content));
    if (hit) {
      router = hit[0];
      routerFile = f.path;
      break;
    }
  }
  if (router === "none" && entry && /useState\s*<?[^>]*>?\(\s*["'](home|landing)/i.test(byPath.get(entry) ?? "")) {
    router = "state-switch";
    routerFile = entry;
  }

  const routes: AppMapRoute[] = [];
  const routerSrc = routerFile ? (byPath.get(routerFile) ?? "") : "";
  if (routerFile) {
    const imports = localImports(routerSrc);
    const fileFor = (name: string): string | null => {
      const imp = imports.find((i) => i.names.includes(name));
      return imp ? resolveSpec(routerFile!, imp.spec, paths) : null;
    };
    const jsx = /<Route\b[^>]*?\bpath=["'{]+([^"'}]+)["'}]+[^>]*?element=\{\s*<\s*([A-Z]\w*)/g;
    const jsxRev = /<Route\b[^>]*?element=\{\s*<\s*([A-Z]\w*)[^>]*?\bpath=["'{]+([^"'}]+)["'}]+/g;
    const obj = /path:\s*["']([^"']+)["'][^}]*?(?:element|component):\s*<?\s*([A-Z]\w*)/g;
    const indexRe = /<Route\b[^>]*?\bindex\b[^>]*?element=\{\s*<\s*([A-Z]\w*)/g;
    const seen = new Set<string>();
    const add = (path: string, component: string) => {
      const key = `${path}|${component}`;
      if (seen.has(key)) return;
      seen.add(key);
      routes.push({ path, component, file: fileFor(component) });
    };
    let m: RegExpExecArray | null;
    while ((m = jsx.exec(routerSrc))) add(m[1]!, m[2]!);
    while ((m = jsxRev.exec(routerSrc))) add(m[2]!, m[1]!);
    while ((m = obj.exec(routerSrc))) add(m[1]!, m[2]!);
    while ((m = indexRe.exec(routerSrc))) add("/", m[1]!);
  }

  const pages = [...paths].filter((p) => /^src\/(pages|routes|screens)\/[^/]+\.(t|j)sx$/.test(p)).sort();
  const layouts = code
    .map((f) => f.path)
    .filter((p) => /(Layout|Header|Footer|Nav(bar)?|Shell|SiteNav)\.(t|j)sx$/.test(p))
    .sort();

  const navLinks = new Set<string>();
  for (const p of [...layouts, ...(entry ? [entry] : [])]) {
    const src = byPath.get(p) ?? "";
    const re = /\b(?:to|href)=\{?["'](\/[^"'#?]*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) navLinks.add(m[1]!);
    const arr = /\b(?:to|href|path):\s*["'](\/[^"'#?]*)["']/g;
    while ((m = arr.exec(src))) navLinks.add(m[1]!);
  }

  const deps: Record<string, string[]> = {};
  for (const p of [...pages, ...layouts]) {
    const src = byPath.get(p) ?? "";
    deps[p] = localImports(src)
      .map((i) => resolveSpec(p, i.spec, paths) ?? i.spec)
      .slice(0, 12);
  }

  const styles = [...paths]
    .filter((p) => /^(src\/(index|styles|globals|App)\.css|tailwind\.config\.(t|j)s)$/.test(p))
    .sort();

  return {
    router,
    routerImport: SPEC_FOR[router],
    entry,
    routerFile,
    routes,
    pages,
    layouts,
    navLinks: [...navLinks].sort(),
    styles,
    deps,
  };
}

/** Compact, prompt-ready block. Bounded so it never crowds out code context. */
export function renderAppMapBlock(map: AppMap, maxChars = 1800): string {
  const lines: string[] = [];
  lines.push("\n\nAPP MAP (read from the current files — authoritative; current files beat any project notes):");
  if (map.routerImport) {
    lines.push(
      `- Routing: ${map.router} via "${map.routerImport}" in ${map.routerFile}. Add/change pages ONLY through this router. Never introduce another routing mechanism or import a different router package.`,
    );
  } else if (map.router === "state-switch") {
    lines.push(`- Routing: state-based page switching in ${map.routerFile}. Keep that approach.`);
  } else {
    lines.push("- Routing: none detected (single page).");
  }
  if (map.entry) lines.push(`- App entry: ${map.entry}`);
  if (map.routes.length) {
    lines.push(
      `- Routes: ${map.routes.map((r) => `${r.path} → ${r.component}${r.file ? ` (${r.file})` : ""}`).join("; ")}`,
    );
  }
  if (map.pages.length) lines.push(`- Pages: ${map.pages.join(", ")}`);
  if (map.layouts.length) lines.push(`- Shared layout/header/footer (reuse, don't duplicate): ${map.layouts.join(", ")}`);
  if (map.navLinks.length) lines.push(`- Navigation links: ${map.navLinks.join(", ")}`);
  if (map.styles.length) lines.push(`- Design system files: ${map.styles.join(", ")}`);
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 20)}\n- …(trimmed)`;
  return out;
}

/** Small fact list for observability events. */
export function appMapFacts(map: AppMap): Record<string, unknown> {
  return {
    router: map.router,
    routerFile: map.routerFile,
    entry: map.entry,
    routes: map.routes.map((r) => r.path),
    pages: map.pages.length,
    layouts: map.layouts,
  };
}
