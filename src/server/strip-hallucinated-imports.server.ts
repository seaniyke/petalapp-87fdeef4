/**
 * Strip imports for npm-confirmed-hallucinated packages.
 *
 * The npm pre-flight tier (Tier 2.45) confirms which bare imports point at
 * packages that don't exist on the npm registry. The polish-pass model is
 * SUPPOSED to fix them, but it only gets one shot and may miss some — and
 * any miss means the build dies at `Failed to resolve import` time.
 *
 * This module is the deterministic safety net: given a list of hallucinated
 * package roots, it scans every changed file and:
 *   1. Removes the import line entirely.
 *   2. Replaces any JSX usage of an imported identifier with a small inline
 *      placeholder div so the page still renders.
 *   3. Replaces non-JSX usages with `null` so the file still compiles.
 *
 * The output is intentionally ugly — the goal is "ship a working app the
 * user can iterate on", not "ship the app the model intended". The
 * Continue-building chip then nudges the user to ask Petal to reimplement
 * those sections with real packages.
 */

import type { ProjectFile } from "@/server/generate.server";

const SCANNABLE = /\.(tsx?|jsx?)$/;

export interface StripResult {
  files: ProjectFile[];
  /** Number of files that had at least one import stripped. */
  filesChanged: number;
  /** Count of import lines removed across all files. */
  importsRemoved: number;
  /** Notes for telemetry / logs. */
  notes: string[];
}

/** True if `pkgRoot` matches the bare package root in `importPath`. */
function importMatchesPackage(importPath: string, pkgRoot: string): boolean {
  if (importPath === pkgRoot) return true;
  if (importPath.startsWith(`${pkgRoot}/`)) return true;
  return false;
}

/** Extract the bare package root (e.g. "react" from "react/jsx-runtime",
 *  "@scope/pkg" from "@scope/pkg/sub"). Returns null for relative or alias
 *  imports. */
function packageRoot(importPath: string): string | null {
  if (importPath.startsWith(".") || importPath.startsWith("/")) return null;
  if (importPath.startsWith("@/")) return null;
  if (importPath.startsWith("@") && importPath.includes("/")) {
    const parts = importPath.split("/");
    return `${parts[0]}/${parts[1]}`;
  }
  return importPath.split("/")[0];
}

/** Parse the identifiers introduced by an import statement.
 *  Handles `import X from`, `import { A, B as C } from`, `import * as N from`,
 *  and side-effect-only `import "x"` (returns []). */
function parseImportedIdents(importLine: string): string[] {
  const idents: string[] = [];
  const m = importLine.match(/^\s*import\s+([\s\S]+?)\s+from\s+["']/);
  if (!m) return idents; // side-effect import has nothing to substitute
  const clause = m[1].trim();

  // Default import + maybe namespace/named tail.
  // e.g. "Foo, { Bar, Baz as Qux }" or "Foo" or "* as N" or "{ A, B }"
  const namedMatch = clause.match(/\{([^}]*)\}/);
  if (namedMatch) {
    for (const raw of namedMatch[1].split(",")) {
      const piece = raw.trim();
      if (!piece) continue;
      const asMatch = piece.match(/\bas\s+(\w+)/);
      if (asMatch) idents.push(asMatch[1]);
      else idents.push(piece.split(/\s+/)[0]);
    }
  }
  const head = clause.replace(/\{[^}]*\}/, "").trim().replace(/,$/, "").trim();
  if (head) {
    const nsMatch = head.match(/^\*\s+as\s+(\w+)/);
    if (nsMatch) idents.push(nsMatch[1]);
    else if (/^\w+$/.test(head)) idents.push(head);
    else if (head.includes(",")) {
      // "Default," — peel off Default
      const def = head.split(",")[0].trim();
      if (/^\w+$/.test(def)) idents.push(def);
    }
  }
  return idents.filter(Boolean);
}

/** Replace bare identifier usages in source. We do NOT touch identifiers
 *  inside strings or comments — the brute-force regex skips them by
 *  matching on JS-style boundaries only. JSX `<Ident ...>` becomes
 *  `<div ...>` and `</Ident>` becomes `</div>` (best-effort). Other
 *  expression usages get replaced with `null`. This produces ugly but
 *  COMPILABLE code. */
function neutraliseIdentifier(src: string, ident: string): string {
  if (!ident) return src;
  // 1. JSX opening: <Ident ...> or <Ident ... />
  let out = src.replace(
    new RegExp(`<${ident}\\b`, "g"),
    "<div data-petal-stub",
  );
  // 2. JSX closing
  out = out.replace(new RegExp(`</${ident}>`, "g"), "</div>");
  // 3. Other usages: replace bare identifier (not preceded by . or word char,
  //    and not followed by word char) with `null`. This handles function
  //    calls, prop values, etc. We keep it surgical to avoid hitting
  //    identifiers in other contexts.
  out = out.replace(
    new RegExp(`(?<![\\w.])${ident}(?![\\w])`, "g"),
    "null",
  );
  return out;
}

export function stripHallucinatedImports(
  files: ProjectFile[],
  hallucinated: string[],
  changedPaths: string[],
): StripResult {
  if (hallucinated.length === 0) {
    return { files, filesChanged: 0, importsRemoved: 0, notes: [] };
  }
  const changed = new Set(changedPaths);
  const halluSet = new Set(hallucinated);
  const notes: string[] = [];
  let filesChanged = 0;
  let importsRemoved = 0;

  const next = files.map((f) => {
    if (!changed.has(f.path) || !SCANNABLE.test(f.path)) return f;

    const lines = f.content.split("\n");
    const keepLines: string[] = [];
    const stubIdents: string[] = [];
    let touched = false;

    // Multi-line import handling: collapse continuations onto one logical line
    // for matching. We do a simple pass that joins lines until we see `from`
    // or a closing `;`. This is robust enough for code emitted by the model.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("import ")) {
        let logical = line;
        let j = i;
        // accumulate continuation lines until we see " from " then a string-end ;
        while (
          j < lines.length - 1 &&
          !/from\s+["'][^"']+["']\s*;?/.test(logical)
        ) {
          j++;
          logical += "\n" + lines[j];
        }
        const fromMatch = logical.match(/from\s+["']([^"']+)["']/);
        const sideEffect = !fromMatch
          ? logical.match(/^\s*import\s+["']([^"']+)["']/)
          : null;
        const importPath = fromMatch?.[1] ?? sideEffect?.[1] ?? null;
        const root = importPath ? packageRoot(importPath) : null;
        if (root && halluSet.has(root)) {
          // Drop these lines entirely, capture identifiers for stubbing.
          const idents = parseImportedIdents(logical);
          stubIdents.push(...idents);
          importsRemoved++;
          touched = true;
          i = j;
          continue;
        }
        // not a hallucination — keep all the lines we accumulated
        for (let k = i; k <= j; k++) keepLines.push(lines[k]);
        i = j;
        continue;
      }
      keepLines.push(line);
    }

    if (!touched) return f;
    filesChanged++;
    let body = keepLines.join("\n");
    for (const id of stubIdents) {
      body = neutraliseIdentifier(body, id);
    }
    notes.push(
      `${f.path}: removed ${stubIdents.length || 0} ident${stubIdents.length === 1 ? "" : "s"}`,
    );
    return { ...f, content: body };
  });

  return { files: next, filesChanged, importsRemoved, notes };
}
