/**
 * Default-vs-named export mismatch repair.
 *
 * Real build killer: the model writes `export function Dashboard()` in
 * `src/pages/Dashboard.tsx` and then `import Dashboard from "./pages/Dashboard"`
 * in `src/App.tsx`. Rollup fails with `"default" is not exported by …`, and
 * until now the final parse guard reverted the whole turn — the user got
 * nothing back for a one-line fix.
 *
 * Repair strategy: add the missing `export default` to the TARGET file rather
 * than rewriting importers. One append fixes every importer at once and can
 * never break an existing named import.
 *
 * Pure: ProjectFile[] -> ProjectFile[]. Conservative — only acts when the
 * intended component is unambiguous.
 */

import type { ProjectFile } from "./generate.server";

const CODE = /\.(tsx?|jsx?)$/;
const DEFAULT_IMPORT =
  /import\s+(?!type\s)([A-Za-z_$][\w$]*)(?:\s*,\s*(?:\{[^}]+\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s*["']([^"']+)["']/g;

function resolve(fromPath: string, spec: string, byPath: Map<string, ProjectFile>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (byPath.has(c)) return c;
  }
  return null;
}

function hasDefaultExport(src: string): boolean {
  return /export\s+default\s/.test(src) || /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(src);
}

function hasStarReexport(src: string): boolean {
  return /export\s+\*\s+from/.test(src);
}

/** Value (not type) exports that look like components. */
function namedComponentExports(src: string): string[] {
  const out = new Set<string>();
  const rx = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src))) out.add(m[1]);
  const braced = /export\s*\{([^}]+)\}(?!\s*from)/g;
  while ((m = braced.exec(src))) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Z][A-Za-z0-9_]*$/.test(name)) out.add(name);
    }
  }
  return [...out];
}

export interface ExportShapeResult {
  files: ProjectFile[];
  notes: string[];
  fixes: number;
}

export function fixExportShape(files: ProjectFile[]): ExportShapeResult {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const additions = new Map<string, string>(); // target path -> component name

  for (const f of files) {
    if (!CODE.test(f.path)) continue;
    DEFAULT_IMPORT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DEFAULT_IMPORT.exec(f.content))) {
      const local = m[1];
      const spec = m[2];
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const targetPath = resolve(f.path, spec, byPath);
      if (!targetPath || !CODE.test(targetPath)) continue;
      const target = byPath.get(targetPath)!;
      if (hasDefaultExport(target.content) || hasStarReexport(target.content)) continue;

      const named = namedComponentExports(target.content);
      const pick = named.includes(local) ? local : named.length === 1 ? named[0] : null;
      if (!pick) continue; // ambiguous — leave it for the verifier to report
      additions.set(targetPath, pick);
    }
  }

  if (additions.size === 0) return { files, notes: [], fixes: 0 };

  const next = files.map((f) => {
    const pick = additions.get(f.path);
    if (!pick) return f;
    return { ...f, content: `${f.content.replace(/\s*$/, "")}\n\nexport default ${pick};\n` };
  });

  return {
    files: next,
    notes: [
      `export-shape: added a default export to ${additions.size} file(s) that were default-imported (${[...additions.keys()]
        .map((p) => p.split("/").pop())
        .slice(0, 3)
        .join(", ")})`,
    ],
    fixes: additions.size,
  };
}
