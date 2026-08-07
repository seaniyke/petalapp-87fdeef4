/**
 * Deterministic repair for leaked markdown code fences inside source files.
 *
 * Root cause this fixes: the model sometimes writes a file whose content
 * still carries chat formatting — a ```lang fence (often mid-file, as a
 * "here's an example" block it forgot to strip). esbuild dies immediately:
 *
 *   src/pages/PostPage.tsx:22:3: ERROR: Expected ";" but found "typescript"
 *
 * No other pass can help: the transform aborts before imports or JSX are
 * ever inspected. So this runs FIRST, ahead of every other syntax healer.
 *
 * Safety: fences are only removed when the fence line sits in real code
 * position. A ``` inside a string, template literal, or comment (very
 * common in markdown-rendering demo components) is left untouched — we run
 * a small lexer over the file to know which state each line starts in.
 */
import type { ProjectFile } from "./generate.server";

export interface FenceFixResult {
  files: ProjectFile[];
  notes: string[];
}

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

type LineState = { code: boolean };

/**
 * Returns, for each line, whether that line STARTS in plain code position
 * (not inside a string, template literal, or block comment).
 */
function lineStates(lines: string[]): { states: LineState[]; unterminated: boolean } {
  const states: LineState[] = [];
  let inBlockComment = false;
  let inTemplate = false;
  let quote: '"' | "'" | null = null;

  for (const line of lines) {
    states.push({ code: !inBlockComment && !inTemplate && quote === null });

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
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
      if (ch === "/" && next === "/") break; // line comment
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
    }
    // Unterminated single-quoted strings never span lines in valid JS.
    quote = null;
  }
  return { states, unterminated: inBlockComment || inTemplate || quote !== null };
}

function stripFences(source: string): { content: string; removed: number } {
  const lines = source.split("\n");
  const { states, unterminated } = lineStates(lines);
  const drop = new Set<number>();
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    // A preceding malformed, unterminated literal can desynchronise the tiny
    // lexer. In that already-invalid case, a standalone fence pair is still
    // unambiguously leaked chat formatting and must not be allowed through.
    if (!states[i]?.code && !unterminated) continue;
    if (!FENCE.test(lines[i])) continue;

    // Find the matching closing fence in code position.
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (FENCE.test(lines[j])) {
        close = j;
        break;
      }
    }

    if (close === -1) {
      // Unterminated fence: everything from here on is leaked markdown.
      for (let j = i; j < lines.length; j++) drop.add(j);
      removed++;
      break;
    }

    const isOpeningWrapper = i === 0;
    const isClosingWrapper = close === lines.length - 1 || lines.slice(close + 1).every((l) => l.trim() === "");
    if (isOpeningWrapper && isClosingWrapper) {
      // Whole file wrapped in a fence — keep the body, drop the wrapper.
      drop.add(i);
      drop.add(close);
    } else {
      // Mid-file leaked example block — drop the fence and its contents.
      for (let j = i; j <= close; j++) drop.add(j);
    }
    removed++;
    i = close;
  }

  if (removed === 0) return { content: source, removed: 0 };
  return { content: lines.filter((_, i) => !drop.has(i)).join("\n"), removed };
}

/**
 * The other half of the fence problem: markdown content stored INSIDE a
 * template literal, where the model forgot to escape the backticks.
 *
 *   const POST = `
 *   ```typescript          <- accidentally closes the template literal
 *   const greeting = `hi`; <- and so does this
 *   ```
 *   `;
 *
 * That block is legitimate content, so it must be escaped, not deleted. We
 * find each template literal that opens at the end of a line and closes on a
 * line of its own; when the region between them contains a markdown fence, we
 * escape every backtick and `${` inside it.
 */
const CONTENT_FENCE = /^\s*(`{3,}|~{3,})/;
const TEMPLATE_CLOSE = /^\s*`\s*[;,)\]]*\s*$/;

function escapeRegionLine(line: string): string {
  return line.replace(/\\?`/g, "\\`").replace(/\\?\$\{/g, "\\${");
}

export function escapeFencesInTemplates(source: string): { content: string; escaped: number } {
  const lines = source.split("\n");
  let escaped = 0;
  let inBlockComment = false;
  let inTemplate = false;
  let templateStart = -1;
  let quote: '"' | "'" | null = null;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];

    if (inTemplate && templateStart >= 0) {
      // Look for the end of this template literal, then decide in one shot.
      let end = -1;
      let hasFence = false;
      for (let j = n; j < lines.length; j++) {
        if (TEMPLATE_CLOSE.test(lines[j])) {
          end = j;
          break;
        }
        if (CONTENT_FENCE.test(lines[j])) hasFence = true;
      }
      if (end === -1 || !hasFence) {
        // Not the markdown-content shape — hand control back to the lexer.
        inTemplate = false;
        templateStart = -1;
        n = n - 1;
        continue;
      }
      for (let j = n; j < end; j++) {
        const next = escapeRegionLine(lines[j]);
        if (next !== lines[j]) {
          lines[j] = next;
          escaped++;
        }
      }
      inTemplate = false;
      templateStart = -1;
      n = end;
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (inTemplate) {
        if (ch === "\\") i++;
        else if (ch === "`") {
          inTemplate = false;
          templateStart = -1;
        }
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        templateStart = n;
        continue;
      }
    }
    quote = null;
  }

  if (escaped === 0) return { content: source, escaped: 0 };
  return { content: lines.join("\n"), escaped };
}


export function fixMarkdownFences(files: ProjectFile[]): FenceFixResult {
  const notes: string[] = [];
  const out = files.map((file) => {
    if (!CODE_FILE.test(file.path)) return file;
    if (!file.content.includes("```") && !file.content.includes("~~~")) return file;

    // Escape content fences first so the stripper only ever sees fences that
    // really are leaked chat formatting in code position.
    const { content: pre, escaped } = escapeFencesInTemplates(file.content);
    const { content, removed } = stripFences(pre);
    if (removed === 0 && escaped === 0) return file;
    if (escaped > 0)
      notes.push(`markdown-fence: escaped ${escaped} content fence(s) inside a template literal in ${file.path}`);
    if (removed > 0)
      notes.push(`markdown-fence: removed ${removed} leaked code fence(s) in ${file.path}`);
    return { ...file, content };
  });
  return { files: out, notes };
}

