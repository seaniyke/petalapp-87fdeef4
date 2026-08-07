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
  let regex = false;
  let regexClass = false;
  let lastSignificant = "";
  let lineComment = false;
  let blockComment = false;

  const regexCanStartHere = () =>
    lastSignificant === "" || !/[A-Za-z0-9_$)\]}'"`]/.test(lastSignificant);

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
    if (regex) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i++;
      } else if (ch === "[" && !regexClass) {
        regexClass = true;
      } else if (ch === "]" && regexClass) {
        regexClass = false;
      } else if (ch === "/" && !regexClass) {
        regex = false;
        lastSignificant = "/";
      } else if (ch === "\n") {
        regex = false;
        regexClass = false;
        lastSignificant = "";
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
    if (ch === "/" && regexCanStartHere()) {
      regex = true;
      regexClass = false;
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
    if (!/\s/.test(ch)) lastSignificant = ch;
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

/**
 * Markdown content inside a template literal whose backticks were never
 * escaped accidentally terminates the literal. The block is real content, so
 * escape it instead of deleting it. Mirrors
 * src/server/markdown-fence-fixer.server.ts.
 */
const CONTENT_FENCE = /^\s*(`{3,}|~{3,})/;
const TEMPLATE_CLOSE = /^\s*`\s*[;,)\]]*\s*$/;

function escapeRegionLine(line: string): string {
  return line.replace(/\\?`/g, "\\`").replace(/\\?\$\{/g, "\\${");
}

export function escapeFencesInTemplates(source: string): { out: string; count: number } {
  if (!source.includes("```") && !source.includes("~~~")) return { out: source, count: 0 };
  const lines = source.split("\n");
  let inBlockComment = false;
  let inTemplate = false;
  let quote: string | null = null;
  let count = 0;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];

    if (inTemplate) {
      let end = -1;
      let hasFence = false;
      for (let j = n; j < lines.length; j++) {
        if (TEMPLATE_CLOSE.test(lines[j])) { end = j; break; }
        if (CONTENT_FENCE.test(lines[j])) hasFence = true;
      }
      if (end === -1 || !hasFence) {
        inTemplate = false;
        n = n - 1;
        continue;
      }
      for (let j = n; j < end; j++) {
        const next = escapeRegionLine(lines[j]);
        if (next !== lines[j]) { lines[j] = next; count++; }
      }
      inTemplate = false;
      n = end;
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; i++; }
        continue;
      }
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "`") { inTemplate = true; continue; }
    }
    quote = null;
  }

  if (count === 0) return { out: source, count: 0 };
  return { out: lines.join("\n"), count };
}

/**
 * Strip leaked markdown code fences that sit in real code position.
 * A ``` inside a string/template/comment is left alone.
 */


export function stripMarkdownFences(source: string): { out: string; count: number } {
  if (!source.includes("```") && !source.includes("~~~")) return { out: source, count: 0 };
  const FENCE = /^\s*(`{3,}|~{3,})/;
  const lines = source.split("\n");


  // Determine which lines start in plain code position.
  const codeStart: boolean[] = [];
  let inBlockComment = false;
  let inTemplate = false;
  let quote: string | null = null;
  for (const line of lines) {
    codeStart.push(!inBlockComment && !inTemplate && quote === null);
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; i++; }
        continue;
      }
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (inTemplate) {
        if (ch === "\\") i++;
        else if (ch === "`") inTemplate = false;
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "`") { inTemplate = true; continue; }
    }
    quote = null;
  }
  const unterminated = inBlockComment || inTemplate || quote !== null;

  const drop = new Set<number>();
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i) || (!codeStart[i] && !unterminated) || !FENCE.test(lines[i])) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (FENCE.test(lines[j])) { close = j; break; }
    }
    if (close === -1) {
      for (let j = i; j < lines.length; j++) drop.add(j);
      count++;
      break;
    }
    const wrapsFile = i === 0 && lines.slice(close + 1).every((l) => l.trim() === "");
    if (wrapsFile) {
      drop.add(i);
      drop.add(close);
    } else {
      for (let j = i; j <= close; j++) drop.add(j);
    }
    count++;
    i = close;
  }

  if (count === 0) return { out: source, count: 0 };
  return { out: lines.filter((_, i) => !drop.has(i)).join("\n"), count };
}

export function healSyntax(files: HealFile[]): { files: HealFile[]; notes: string[] } {
  const notes: string[] = [];
  const out = files.map((f) => {
    if (!SOURCE_RX.test(f.path) || typeof f.content !== "string") return f;

    const templateSafe = escapeFencesInTemplates(f.content);
    const fence = stripMarkdownFences(templateSafe.out);

    const esc = unescapeCodePositions(fence.out);
    // Literal `\n` decoding above may have put a previously invisible fence
    // on its own line. Re-run the idempotent stripper before parsing imports.
    const revealedFence = stripMarkdownFences(esc.out);
    const imp = repairImportSyntax(revealedFence.out);
    const jsx = /\.(tsx|jsx)$/i.test(f.path)
      ? repairJsxAttributeLiterals(imp.out)
      : { out: imp.out, count: 0 };
    if (templateSafe.count === 0 && fence.count === 0 && revealedFence.count === 0 && esc.count === 0 && imp.count === 0 && jsx.count === 0) return f;

    if (templateSafe.count > 0)
      notes.push(`${f.path}: escaped ${templateSafe.count} content fence(s) inside a template literal`);
    const fenceCount = fence.count + revealedFence.count;
    if (fenceCount > 0) notes.push(`${f.path}: removed ${fenceCount} leaked code fence(s)`);

    if (esc.count > 0) notes.push(`${f.path}: decoded ${esc.count} literal escape(s)`);
    if (imp.count > 0) notes.push(`${f.path}: restored \`from\` in ${imp.count} import(s)`);
    if (jsx.count > 0) notes.push(`${f.path}: wrapped ${jsx.count} JSX attribute literal(s)`);
    return { ...f, content: jsx.out };
  });
  return { files: out, notes };
}

