/**
 * Dependency closure — deterministic, no AI.
 *
 * The build bundles every file reachable from the entry, including starter
 * kit files a page pulls in (e.g. pages → @/components/motion → framer-motion).
 * Checking only this turn's files missed those packages, and the live V4.1
 * run failed with "Rollup failed to resolve import framer-motion". This walks
 * the real import graph and returns every package it needs that
 * package.json doesn't list. It only ever ADDS dependencies.
 */
import type { ProjectFile } from "@/server/generate.server";
import { KNOWN_PACKAGES, withRequiredPeers } from "@/server/known-packages";

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const BUILTINS = new Set(["react", "react-dom"]);

function rootOf(spec: string): string {
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
}

function resolveLocal(spec: string, from: string, byPath: Map<string, ProjectFile>): string | null {
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
  for (const e of EXTS) if (byPath.has(base + e)) return base + e;
  return null;
}

export function missingReachableDeps(files: ProjectFile[], entry = "src/main.tsx"): string[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  let declared: Record<string, string> = {};
  try {
    const pkg = JSON.parse(byPath.get("package.json")?.content ?? "{}");
    declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch { /* unparsable: treat as empty */ }
  const start = byPath.has(entry) ? entry : byPath.has("src/App.tsx") ? "src/App.tsx" : null;
  if (!start) return [];
  const seen = new Set<string>([start]);
  const queue = [start];
  const needed = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    const src = byPath.get(path)?.content ?? "";
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec || /\.(css|svg|png|jpe?g|webp|gif|json)$/.test(spec)) continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const next = resolveLocal(spec, path, byPath);
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
        continue;
      }
      if (/^(node:|virtual:|~)/.test(spec)) continue;
      needed.add(rootOf(spec));
    }
  }
  const missing = [...needed].filter((p) => !declared[p] && !BUILTINS.has(p));
  return withRequiredPeers(missing).filter((p) => !declared[p]);
}

/** Add the missing packages (known version, else "*"). Returns new content. */
export function addMissingDeps(pkgContent: string, missing: string[]): string {
  const pkg = JSON.parse(pkgContent) as { dependencies?: Record<string, string> };
  const deps = (pkg.dependencies ??= {});
  for (const p of missing) if (!deps[p]) deps[p] = KNOWN_PACKAGES[p] ?? "*";
  return JSON.stringify(pkg, null, 2) + "\n";
}
