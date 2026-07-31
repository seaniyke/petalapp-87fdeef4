/**
 * Deterministic repair for malformed ES import statements.
 *
 * Production failure (ShopStyle Pro, build bfe16356…):
 *
 *   import { Separator } '@/components/ui/separator';
 *                       ^ esbuild: Expected "from" but found "'@/…'"
 *
 * The model dropped the `from` keyword (or typo'd it). esbuild aborts the
 * whole transform, so no other repair pass — and no LLM auto-fix turn — ever
 * gets a chance. The shape is unambiguous, so we heal it mechanically.
 *
 * Handled shapes (line-anchored, so string/JSX content is not touched):
 *   import { A, B }  '…'        → import { A, B } from '…'
 *   import Default   '…'        → import Default from '…'
 *   import * as ns   '…'        → import * as ns from '…'
 *   import type { A } '…'       → import type { A } from '…'
 *   import { A } form '…'       → import { A } from '…'   (from typos)
 */

import type { ProjectFile } from "./generate.server";

export interface ImportSyntaxFixResult {
  files: ProjectFile[];
  notes: string[];
}

const SOURCE_RX = /\.(tsx?|jsx?|mts|cts)$/i;

/** `from` misspellings the model emits often enough to be worth healing. */
const FROM_TYPOS = /^(\s*import\s+(?![\s'"])[^;'"\n]*?)\s+(?:form|fom|frm|rom|form)\s+(['"])/gm;

/** `import <clause> '…'` with the keyword missing entirely. */
const MISSING_FROM_PATTERNS: RegExp[] = [
  // named (optionally with a leading default) — braces may span lines
  /^(\s*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{[^}]*\})\s+(?!from\b)(['"])/gm,
  // namespace (optionally with a leading default): `import React, * as ns '…'`
  /^(\s*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\*\s+as\s+[\w$]+)\s+(?!from\b)(['"])/gm,
  // plain default
  /^(\s*import\s+(?:type\s+)?[\w$]+)\s+(?!from\b)(['"])/gm,
];

export function repairImportSyntax(source: string): { out: string; count: number } {
  let out = source;
  let count = 0;

  out = out.replace(FROM_TYPOS, (_m, head: string, quote: string) => {
    count++;
    return `${head} from ${quote}`;
  });

  for (const rx of MISSING_FROM_PATTERNS) {
    out = out.replace(rx, (_m, head: string, quote: string) => {
      count++;
      return `${head} from ${quote}`;
    });
  }

  return { out, count };
}

export function fixImportSyntax(files: ProjectFile[]): ImportSyntaxFixResult {
  const notes: string[] = [];
  let touched = 0;
  let total = 0;

  const out = files.map((f) => {
    if (!SOURCE_RX.test(f.path) || typeof f.content !== "string") return f;
    const { out: content, count } = repairImportSyntax(f.content);
    if (count === 0) return f;
    touched++;
    total += count;
    return { ...f, content };
  });

  if (touched > 0) {
    notes.push(
      `import-syntax: restored the missing \`from\` keyword in ${total} import(s) across ${touched} file(s)`,
    );
  }

  return { files: out, notes };
}
