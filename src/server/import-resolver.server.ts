/**
 * Deterministic unresolved-import repair.
 *
 * Failure mode this fixes:
 *   The model writes `src/App.tsx` with `import Landing from "./pages/LandingPage"`
 *   but the planner only created `src/sections/Landing.tsx`. Rollup then bails
 *   the production build with `Could not resolve "./pages/LandingPage"`.
 *
 * Strategy (in order, per import):
 *   1. Try to remap the import specifier to an EXISTING file with a matching
 *      basename (case-insensitive; tolerant of common suffixes like "Page",
 *      "Section", "View", and Pascal↔kebab). Rewrite the spec to the alias
 *      form (`@/...`) pointing at the real file.
 *   2. If no match exists, create a minimal stub file at the imported path
 *      that default-exports a tiny section so the build succeeds and the
 *      screen still renders something legible.
 *
 * This runs in stage-wireup BEFORE esbuild so the parser sees a resolvable
 * graph. It also runs in the monolithic path's autofix layer.
 */

import type { ProjectFile } from "./generate.server";

const SCANNABLE = /\.(tsx?|jsx?)$/;
// Capture both `import X from "spec"` and `import "spec"` and `import {a} from "spec"`.
// Note: side-effect imports (`import "spec"`) are matched separately below — this
// regex requires a `from`.
const IMPORT_RE =
  /(^|\n)\s*import\s+(?:type\s+)?(?:(?:[\w*${}\s,]+)\s+from\s+)?["']([^"']+)["']\s*;?/g;

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function resolveSpec(
  fromPath: string,
  spec: string,
  byPath: Map<string, string>,
): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("."))
    base = normalizePath(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`);
  else return "external"; // bare package — handled by bare-import-resolver
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ];
  const exact = candidates.find((p) => byPath.has(p));
  if (exact) return exact;

  // Phase 5: case-insensitive fallback. macOS/Windows file systems are
  // case-insensitive — `import "./Button"` resolves to `button.tsx`
  // locally and crashes on Linux Rollup. Match case-insensitively; the
  // caller rewrites the spec to the canonical path.
  const lowerCands = new Set(candidates.map((p) => p.toLowerCase()));
  for (const p of byPath.keys()) {
    if (lowerCands.has(p.toLowerCase())) return p;
  }
  return null;
}

/** Strip ext + folder, lowercase, drop common suffixes. Used for fuzzy matching. */
function basenameKey(spec: string): string {
  const last = spec.split("/").filter(Boolean).pop() ?? spec;
  const noExt = last.replace(/\.(tsx?|jsx?)$/i, "");
  // Pascal → kebab → lowercase, then strip common suffixes.
  const lower = noExt
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return lower.replace(/-?(page|view|section|screen|component)$/i, "");
}

function pickRemapTarget(
  spec: string,
  byPath: Map<string, string>,
): string | null {
  const key = basenameKey(spec);
  if (!key) return null;
  const candidates: string[] = [];
  for (const p of byPath.keys()) {
    if (!SCANNABLE.test(p)) continue;
    if (!p.startsWith("src/")) continue;
    if (basenameKey(p) === key) candidates.push(p);
  }
  if (candidates.length === 0) return null;
  // Prefer src/sections/* > src/components/* > src/routes/* — sections are
  // the canonical place compositions land in the new pipeline.
  const rank = (p: string) =>
    p.startsWith("src/sections/")
      ? 0
      : p.startsWith("src/components/app/")
        ? 1
        : p.startsWith("src/components/")
          ? 2
          : 3;
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

function toAliasSpec(targetPath: string): string {
  // src/foo/bar.tsx → @/foo/bar
  return targetPath.replace(/^src\//, "@/").replace(/\.(tsx?|jsx?)$/, "");
}

function buildStub(spec: string, importedName: string | null): string {
  const name = importedName ?? "Stub";
  const safeName = /^[A-Z][A-Za-z0-9_]*$/.test(name) ? name : "Stub";
  const label = spec.split("/").pop() ?? "Section";
  return (
    `// Auto-generated stub by Petal import-resolver. The original import target\n` +
    `// did not exist; this lets the build succeed and renders a visible marker.\n` +
    `export default function ${safeName}() {\n` +
    `  return (\n` +
    `    <section className="mx-auto max-w-3xl px-6 py-12">\n` +
    `      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">${label}</p>\n` +
    `      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Coming together</h2>\n` +
    `      <p className="mt-2 text-muted-foreground">This section is being assembled.</p>\n` +
    `    </section>\n` +
    `  );\n` +
    `}\n`
  );
}

function specToStubPath(fromPath: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("."))
    base = normalizePath(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`);
  else return null;
  if (/\.(tsx?|jsx?)$/.test(base)) return base;
  return `${base}.tsx`;
}

/** Try to read the default-import identifier so the stub exports the right name. */
function defaultImportName(line: string): string | null {
  // `import Foo from "..."` or `import Foo, { Bar } from "..."`
  const m = line.match(/import\s+([A-Z][A-Za-z0-9_]*)\s*[,{]?.*?from/);
  return m ? m[1] : null;
}

export interface ImportRepairResult {
  files: ProjectFile[];
  /** Spec rewrites: per-file list of (original spec → new spec). */
  rewrites: Array<{ path: string; from: string; to: string }>;
  /** New stub files we had to create to satisfy unresolved imports. */
  stubsCreated: string[];
}

export function repairUnresolvedImports(files: ProjectFile[]): ImportRepairResult {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const rewrites: ImportRepairResult["rewrites"] = [];
  const stubsCreated: string[] = [];

  // We mutate `byPath` as we go (rewrites + new stubs both feed back into
  // subsequent resolution attempts on later files).
  for (const f of files) {
    if (!SCANNABLE.test(f.path)) continue;
    let src = byPath.get(f.path) ?? f.content;
    let changed = false;

    // Collect (importLine, spec) so we can rewrite by index without
    // double-counting when two imports share a basename.
    const matches: Array<{ full: string; spec: string }> = [];
    src.replace(IMPORT_RE, (full, _lead, spec) => {
      matches.push({ full, spec });
      return full;
    });

    for (const { full, spec } of matches) {
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      const resolved = resolveSpec(f.path, spec, byPath);
      if (resolved) {
        // Phase 5: if resolution only succeeded case-insensitively, the
        // spec doesn't match the on-disk path. Rewrite to the canonical
        // alias form so Linux Rollup resolves it.
        const aliasForm = toAliasSpec(resolved);
        const specBase = spec.startsWith("@/")
          ? `src/${spec.slice(2)}`.toLowerCase()
          : normalizePath(`${f.path.split("/").slice(0, -1).join("/")}/${spec}`).toLowerCase();
        const resolvedNoExt = resolved.replace(/\.(tsx?|jsx?)$/, "").toLowerCase();
        if (specBase !== resolvedNoExt && spec.startsWith("@/")) {
          // Case mismatch on an alias-form import.
          const newLine = full.replace(
            new RegExp(`(["'])${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`),
            `"${aliasForm}"`,
          );
          src = src.replace(full, newLine);
          rewrites.push({ path: f.path, from: spec, to: aliasForm });
          changed = true;
        }
        continue;
      }

      // 1. Remap to an existing file with a matching basename.
      const remap = pickRemapTarget(spec, byPath);
      if (remap) {
        const newSpec = toAliasSpec(remap);
        const newLine = full.replace(
          new RegExp(`(["'])${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`),
          `"${newSpec}"`,
        );
        src = src.replace(full, newLine);
        rewrites.push({ path: f.path, from: spec, to: newSpec });
        changed = true;
        continue;
      }

      // 2. No remap target — create a stub so the build resolves.
      const stubPath = specToStubPath(f.path, spec);
      if (!stubPath) continue;
      if (byPath.has(stubPath)) continue;
      const stub = buildStub(spec, defaultImportName(full));
      byPath.set(stubPath, stub);
      stubsCreated.push(stubPath);
    }

    if (changed) byPath.set(f.path, src);
  }

  return {
    files: Array.from(byPath, ([path, content]) => ({ path, content })),
    rewrites,
    stubsCreated,
  };
}
