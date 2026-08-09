/**
 * Kit dependency closure.
 *
 * Petal ships ~316 scaffold-kit files into every generated project. Many of
 * them (motion primitives, marketing FX, three.js scenes, the TipTap editor,
 * thumbhash images) import npm packages that are deliberately NOT in
 * REQUIRED_DEPS — installing three.js + GSAP + ProseMirror into every todo app
 * would triple install time for nothing.
 *
 * The gap: the bare-import resolver only inspects files the model emitted. When
 * a generated page does `import { FadeIn } from "@/components/motion"`, the
 * kit file behind that path imports `framer-motion` — and nothing ever adds
 * framer-motion to package.json. Vite then dies with
 * `Failed to resolve import "framer-motion"`, and the attached tsc diagnostics
 * point at kit files the user never wrote, so the repair agent edits the wrong
 * thing.
 *
 * This pass closes it deterministically: walk the real module graph from the
 * app entry, collect every bare import inside REACHED files (kit or not), and
 * add the curated pin for anything missing. Unreached kit files stay unbuilt
 * and uninstalled, so there is no bloat.
 */

import type { ProjectFile } from "./generate.server";
import { KNOWN_PACKAGES } from "./known-packages";

const ENTRY_CANDIDATES = [
  "src/main.tsx",
  "src/main.ts",
  "src/main.jsx",
  "src/main.js",
  "src/index.tsx",
  "src/index.ts",
];

/** Bare specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
function packageName(spec: string): string {
  if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
  return spec.split("/")[0] ?? spec;
}

function isRelative(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

/** Resolve an import specifier to a concrete file path in the project. */
function resolvePath(spec: string, fromPath: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = `src/${spec.slice(2)}`;
  } else if (isRelative(spec)) {
    const dir = fromPath.split("/").slice(0, -1);
    const parts = spec.split("/");
    for (const p of parts) {
      if (p === "." || p === "") continue;
      if (p === "..") dir.pop();
      else dir.push(p);
    }
    base = dir.join("/");
  } else {
    return null;
  }
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ];
  for (const c of candidates) if (paths.has(c)) return c;
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (spec) out.push(spec);
  }
  return out;
}

export interface KitDepClosureResult {
  files: ProjectFile[];
  /** Packages added to package.json, pinned. */
  added: Record<string, string>;
  notes: string[];
}

/**
 * Add curated pins for every npm package imported by a file that is actually
 * reachable from the app entry. Idempotent and side-effect free.
 */
export function closeKitDependencies(files: ProjectFile[]): KitDepClosureResult {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const paths = new Set(byPath.keys());
  const pkgFile = byPath.get("package.json");
  if (!pkgFile) return { files, added: {}, notes: [] };

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgFile.content) as Record<string, unknown>;
  } catch {
    // A malformed package.json is somebody else's failure to report; don't
    // compound it by throwing here.
    return { files, added: {}, notes: [] };
  }
  const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};

  const entries = ENTRY_CANDIDATES.filter((p) => paths.has(p));
  if (entries.length === 0) return { files, added: {}, notes: [] };

  const seen = new Set<string>();
  const queue = [...entries];
  const bare = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const file = byPath.get(current);
    if (!file || !/\.(t|j)sx?$/.test(current)) continue;
    for (const spec of specifiersOf(file.content)) {
      if (spec.startsWith("@/") || isRelative(spec)) {
        const next = resolvePath(spec, current, paths);
        if (next && !seen.has(next)) queue.push(next);
        continue;
      }
      if (spec.startsWith("node:") || spec.startsWith("http")) continue;
      // CSS/asset side-effect imports resolve through Vite, not npm deps.
      if (/\.(css|scss|svg|png|jpe?g|webp|json)$/.test(spec)) {
        const pkgOnly = packageName(spec);
        if (pkgOnly && !pkgOnly.includes(".")) bare.add(pkgOnly);
        continue;
      }
      bare.add(packageName(spec));
    }
  }

  const added: Record<string, string> = {};
  for (const name of bare) {
    if (!name || deps[name] || devDeps[name]) continue;
    const pin = KNOWN_PACKAGES[name];
    if (!pin) continue; // unknown packages remain the bare-import resolver's job
    deps[name] = pin;
    added[name] = pin;
  }
  if (Object.keys(added).length === 0) return { files, added: {}, notes: [] };

  pkg.dependencies = deps;
  const nextFiles = files.map((f) =>
    f.path === "package.json" ? { ...f, content: `${JSON.stringify(pkg, null, 2)}\n` } : f,
  );
  return {
    files: nextFiles,
    added,
    notes: [
      `kit-dep-closure: installed ${Object.keys(added).join(", ")} for imported scaffold modules`,
    ],
  };
}
