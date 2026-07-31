/**
 * Builder-side last line of defense.
 *
 * The app server already heals these shapes before it posts a build, but the
 * builder must never depend on that: it is a separate deploy, it also serves
 * retried/queued payloads, and esbuild aborts the ENTIRE vite build on a
 * single malformed statement. So we re-run the two purely mechanical repairs
 * against the exact bytes we are about to write to disk.
 *
 * Kept self-contained on purpose — the builder cannot import from the app's
 * `src/server`. Mirrors:
 *   - src/server/source-escape-fixer.server.ts (literal `\n` in code position)
 *   - src/server/import-syntax-fixer.server.ts (missing `from` keyword)
 */

export type HealFile = { path: string; content: string };

const SOURCE_RX = /\.(tsx?|jsx?|mts|cts)$/i;

/** `from` misspellings the model emits often enough to be worth healing. */
const FROM_TYPOS = /^(\s*import\s+(?![\s'"])[^;'"\n]*?)\s+(?:form|fom|frm|rom)\s+(['"])/gm;

const MISSING_FROM_PATTERNS: RegExp[] = [
  /^(\s*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{[^}]*\})\s+(?!from\b)(['"])/gm,
  /^(\s*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\*\s+as\s+[\w$]+)\s+(?!from\b)(['"])/gm,
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

/**
 * Decode two-character `\n` / `\t` sequences that appear in *code* position
 * (i.e. outside of string literals and comments). Inside a string literal
 * they are legitimate escapes and must be preserved.
 */
export function unescapeCodePositions(src: string): { out: string; count: number } {
  let out = "";
  let count = 0;
  let quote: '"' | "'" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (lineComment) {
      out += ch;
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i++;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      // A real newline can never appear inside a non-template literal; if we
      // see one, our quote tracking drifted (unescaped apostrophe in text).
      if (ch === "\n" && quote !== "`") {
        quote = null;
        out += ch;
        continue;
      }
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "\\" && (next === "n" || next === "t" || next === "r")) {
      out += next === "t" ? "  " : "\n";
      count++;
      i++;
      continue;
    }
    out += ch;
  }

  return { out, count };
}

export function healSyntax(files: HealFile[]): { files: HealFile[]; notes: string[] } {
  const notes: string[] = [];
  const out = files.map((f) => {
    if (!SOURCE_RX.test(f.path) || typeof f.content !== "string") return f;

    const esc = unescapeCodePositions(f.content);
    const imp = repairImportSyntax(esc.out);
    if (esc.count === 0 && imp.count === 0) return f;

    if (esc.count > 0) notes.push(`${f.path}: decoded ${esc.count} literal escape(s)`);
    if (imp.count > 0) notes.push(`${f.path}: restored \`from\` in ${imp.count} import(s)`);
    return { ...f, content: imp.out };
  });
  return { files: out, notes };
}
