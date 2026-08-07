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
function lineStates(lines: string[]): LineState[] {
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
  return states;
}

function stripFences(source: string): { content: string; removed: number } {
  const lines = source.split("\n");
  const states = lineStates(lines);
  const drop = new Set<number>();
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    if (!states[i]?.code) continue;
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

export function fixMarkdownFences(files: ProjectFile[]): FenceFixResult {
  const notes: string[] = [];
  const out = files.map((file) => {
    if (!CODE_FILE.test(file.path)) return file;
    if (!file.content.includes("```") && !file.content.includes("~~~")) return file;
    const { content, removed } = stripFences(file.content);
    if (removed === 0) return file;
    notes.push(`markdown-fence: removed ${removed} leaked code fence(s) in ${file.path}`);
    return { ...file, content };
  });
  return { files: out, notes };
}
