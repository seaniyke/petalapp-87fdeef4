/**
 * Builder-side last line of defense.
 *
 * The app server already heals these shapes before it posts a build, but the
 * builder must never depend on that: it is a separate deploy, it also serves
 * retried/queued payloads, and esbuild aborts the ENTIRE vite build on a
 * single malformed statement. So we re-run the purely mechanical repairs
 * against the exact bytes we are about to write to disk.
 *
 * Kept self-contained on purpose — the builder cannot import from the app's
 * `src/server`. Mirrors:
 *   - src/server/source-escape-fixer.server.ts (literal `\n` in code position)
 *   - src/server/import-syntax-fixer.server.ts (missing `from` keyword)
 *   - src/server/jsx-attr-literal-fixer.server.ts (unbraced JSX values)
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

/** Find a matching closing bracket while ignoring strings and comments. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  const expected = pairs[src[open]];
  if (!expected) return -1;

  const stack = [expected];
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Ignore `>` inside JSX expression containers, strings, and comments. */
function hasTopLevelTagClose(src: string): boolean {
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let braces = 0;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/" && braces > 0) {
      lineComment = true;
      i++;
    } else if (ch === "/" && next === "*" && braces > 0) {
      blockComment = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") braces++;
    else if (ch === "}" && braces > 0) braces--;
    else if (ch === ">" && braces === 0) return true;
  }
  return false;
}

/** Repair `prop=[…]`, `prop=3`, and `prop=true` inside JSX opening tags. */
export function repairJsxAttributeLiterals(source: string): { out: string; count: number } {
  let out = source;
  let count = 0;
  const arrayAttr = /(^|[\s{(,])([A-Za-z_$][\w$]*)\s*=\s*\[/gm;

  for (let guard = 0; guard < 200; guard++) {
    arrayAttr.lastIndex = 0;
    let match: RegExpExecArray | null;
    let found: RegExpExecArray | null = null;
    while ((match = arrayAttr.exec(out))) {
      const tagStart = out.lastIndexOf("<", match.index);
      if (tagStart === -1) continue;
      const prefix = out.slice(tagStart, match.index);
      if (/^<[A-Za-z][\w.$-]*[\s\S]*$/.test(prefix) && !hasTopLevelTagClose(prefix)) {
        found = match;
        break;
      }
    }
    if (!found) break;

    const open = out.indexOf("[", found.index + found[1].length + found[2].length);
    const close = matchBracket(out, open);
    if (close === -1) break;
    out = `${out.slice(0, open)}{${out.slice(open, close + 1)}}${out.slice(close + 1)}`;
    count++;
  }

  const scalarAttr =
    /(<[A-Za-z][\w.$-]*(?:\s+[^<>]*?)?\s)([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?|true|false|null)(?=[\s/>])/g;
  for (let guard = 0; guard < 50; guard++) {
    const before = out;
    out = out.replace(scalarAttr, (_full, head: string, name: string, value: string) => {
      count++;
      return `${head}${name}={${value}}`;
    });
    if (out === before) break;
  }

  return { out, count };
}

export function healSyntax(files: HealFile[]): { files: HealFile[]; notes: string[] } {
  const notes: string[] = [];
  const out = files.map((f) => {
    if (!SOURCE_RX.test(f.path) || typeof f.content !== "string") return f;

    const esc = unescapeCodePositions(f.content);
    const imp = repairImportSyntax(esc.out);
    const jsx = /\.(tsx|jsx)$/i.test(f.path)
      ? repairJsxAttributeLiterals(imp.out)
      : { out: imp.out, count: 0 };
    if (esc.count === 0 && imp.count === 0 && jsx.count === 0) return f;

    if (esc.count > 0) notes.push(`${f.path}: decoded ${esc.count} literal escape(s)`);
    if (imp.count > 0) notes.push(`${f.path}: restored \`from\` in ${imp.count} import(s)`);
    if (jsx.count > 0) notes.push(`${f.path}: wrapped ${jsx.count} JSX attribute literal(s)`);
    return { ...f, content: jsx.out };
  });
  return { files: out, notes };
}
