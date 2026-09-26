/**
 * Dependency-aware guard for destructive recovery.
 *
 * Criticality is derived from the project's own import graph, never from a
 * hard-coded filename list:
 *   - entry modules (referenced by index.html, or src/main.*),
 *   - the shell those entries import directly,
 *   - shared modules imported by two or more reachable files.
 * Removing any of these breaks the app rather than one screen, so they may
 * only be replaced by a validated version, never deleted.
 */
import type { ProjectFile } from "@/server/generate.server";

const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

function norm(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

export function resolveSpecifier(from: string, spec: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = norm(`${from.split("/").slice(0, -1).join("/")}/${spec}`);
  else if (spec.startsWith("/")) base = norm(spec);
  else return null;
  for (const ext of EXTS) if (paths.has(base + ext)) return base + ext;
  return null;
}

export function importsOf(file: ProjectFile, paths: Set<string>): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(file.content))) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const r = resolveSpecifier(file.path, spec, paths);
    if (r) out.push(r);
  }
  return out;
}

export function entryModules(files: ProjectFile[]): string[] {
  const paths = new Set(files.map((f) => f.path));
  const entries = new Set<string>();
  const html = files.find((f) => f.path === "index.html");
  if (html) {
    for (const m of html.content.matchAll(/<script[^>]*src=["']([^"']+)["']/g)) {
      const r = resolveSpecifier("index.html", m[1].startsWith("/") ? m[1] : `/${m[1]}`, paths);
      if (r) entries.add(r);
    }
  }
  for (const p of ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js"]) if (paths.has(p)) entries.add(p);
  return [...entries];
}

/** Paths among `candidates` whose removal would break the app structure. */
export function structurallyCriticalPaths(files: ProjectFile[], candidates: Iterable<string>): Set<string> {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const entries = entryModules(files);
  const reachable = new Set<string>();
  const importers = new Map<string, Set<string>>();
  const queue = [...entries];
  while (queue.length) {
    const p = queue.shift()!;
    if (reachable.has(p)) continue;
    reachable.add(p);
    const f = byPath.get(p);
    if (!f) continue;
    for (const dep of importsOf(f, paths)) {
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep)!.add(p);
      queue.push(dep);
    }
  }
  const entrySet = new Set(entries);
  const critical = new Set<string>();
  for (const c of candidates) {
    if (!reachable.has(c)) continue;
    const from = importers.get(c) ?? new Set<string>();
    const isEntry = entrySet.has(c);
    const isShell = [...from].some((i) => entrySet.has(i));
    const isShared = from.size >= 2;
    if (isEntry || isShell || isShared) critical.add(c);
  }
  return critical;
}

/**
 * Which of the paths slated for removal must NOT be removed. A critical path
 * may leave the tree only when a replacement (prior verified content) exists —
 * the caller restores that and re-verifies.
 */
export function blockedRemovals(
  files: ProjectFile[],
  toRemove: Iterable<string>,
  hasValidatedReplacement: (path: string) => boolean,
): string[] {
  const critical = structurallyCriticalPaths(files, toRemove);
  return [...critical].filter((p) => !hasValidatedReplacement(p));
}
