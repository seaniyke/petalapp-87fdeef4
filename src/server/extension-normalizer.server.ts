/**
 * Phase 5 — Extension normalizer.
 *
 * Detects files with `.ts` / `.js` extensions that contain JSX. Vite's
 * esbuild loader by default parses `.ts` as TypeScript (no JSX), so these
 * files crash the build with `Expected identifier but found "<"`.
 *
 * The fix: rename the file to `.tsx` / `.jsx` AND rewrite every importer's
 * specifier (only if it included the extension explicitly — alias imports
 * resolve extensions automatically, so most call sites are untouched).
 *
 * Pure ProjectFile[] → ProjectFile[]. No I/O.
 */

import type { ProjectFile } from "./generate.server";

const TS_NO_JSX = /\.(ts|js)$/;
// JSX heuristic: a lowercased opening tag (`<div`) OR a PascalCase JSX
// element (`<Card`) followed by props/children. Conservative — false
// positives on type generics like `Array<string>` are filtered by the
// `>` lookahead requiring a space, `/`, attribute, or closing `>`.
const JSX_RE = /<[A-Za-z][A-Za-z0-9._:-]*(?:\s+[^>]*)?\/?>/;

export interface ExtensionNormalizeResult {
  files: ProjectFile[];
  renamed: Array<{ from: string; to: string }>;
}

export function normalizeJsxExtensions(files: ProjectFile[]): ExtensionNormalizeResult {
  const renamed: ExtensionNormalizeResult["renamed"] = [];
  const renameMap = new Map<string, string>();

  for (const f of files) {
    if (!TS_NO_JSX.test(f.path)) continue;
    // Skip server-only files — they may use JSX-like generics but never
    // ship to the bundler under a non-JSX loader.
    if (f.path.endsWith(".server.ts") || f.path.endsWith(".d.ts")) continue;
    if (!JSX_RE.test(f.content)) continue;
    const next = f.path.replace(/\.ts$/, ".tsx").replace(/\.js$/, ".jsx");
    if (next === f.path) continue;
    renameMap.set(f.path, next);
    renamed.push({ from: f.path, to: next });
  }

  if (renamed.length === 0) return { files, renamed };

  // 1. Apply the renames.
  const out: ProjectFile[] = files.map((f) => {
    const next = renameMap.get(f.path);
    return next ? { path: next, content: f.content } : f;
  });

  // 2. Rewrite any importer that referenced the old path WITH an explicit
  //    extension. Extension-less alias imports (`@/lib/foo`) work either
  //    way, so we leave them alone.
  for (let i = 0; i < out.length; i++) {
    const file = out[i];
    let content = file.content;
    let changed = false;
    for (const [oldPath, newPath] of renameMap) {
      const oldExt = oldPath.slice(oldPath.lastIndexOf("."));
      const newExt = newPath.slice(newPath.lastIndexOf("."));
      const oldNoExt = oldPath.slice(0, -oldExt.length);
      const newNoExt = newPath.slice(0, -newExt.length);
      // Match alias form with explicit ext: `from "@/foo/bar.ts"`
      const aliasOld = `@/${oldNoExt.replace(/^src\//, "")}${oldExt}`;
      const aliasNew = `@/${newNoExt.replace(/^src\//, "")}${newExt}`;
      if (content.includes(aliasOld)) {
        content = content.split(aliasOld).join(aliasNew);
        changed = true;
      }
    }
    if (changed) out[i] = { path: file.path, content };
  }

  return { files: out, renamed };
}
