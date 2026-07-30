/**
 * Deterministic repair for AI-generated CSS that contains *literal* escape
 * sequences instead of real whitespace.
 *
 * Failure mode seen in production:
 *
 *   @theme {
 *     \n --gradient-primary: linear-gradient(...);
 *   }
 *
 * The model emitted the two characters `\` + `n` (a JSON escape that was
 * never decoded) into `src/styles.css`. Tailwind v4 parses `\n --gradient…`
 * as a nested rule and aborts the whole build with:
 *
 *   `@theme` blocks must only contain custom properties or `@keyframes`.
 *
 * The fix is purely mechanical: turn literal `\n` / `\r` / `\t` sequences
 * into real whitespace, then drop any line inside a `@theme { … }` block
 * that is neither a custom property (`--x: …;`), an `@keyframes` block, nor
 * a brace/comment — Tailwind rejects those outright.
 */

import type { ProjectFile } from "./generate.server";

export interface CssEscapeFixResult {
  files: ProjectFile[];
  notes: string[];
}

/** `\n`, `\r`, `\t` written as two literal characters, outside of a `content:` value. */
const LITERAL_ESCAPE = /\\[nrt]/g;

function unescapeLiterals(css: string): { out: string; count: number } {
  let count = 0;
  const out = css.replace(LITERAL_ESCAPE, (m) => {
    count++;
    return m === "\\t" ? "  " : "\n";
  });
  return { out, count };
}

/**
 * Remove illegal lines from every `@theme { … }` block. Only custom
 * properties, `@keyframes` sub-blocks, comments and blank lines survive.
 */
function sanitizeThemeBlocks(css: string): { out: string; removed: string[] } {
  const removed: string[] = [];
  const rx = /@theme[^{]*\{/g;
  let match: RegExpExecArray | null;
  let result = css;

  // Recompute on each pass because we rewrite the string in place.
  rx.lastIndex = 0;
  while ((match = rx.exec(result)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = -1;
    for (let i = start; i < result.length; i++) {
      const ch = result[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;

    const inner = result.slice(start, end);
    // Preserve nested @keyframes blocks verbatim.
    const keyframes: string[] = [];
    const innerNoKeyframes = inner.replace(/@keyframes[\s\S]*?\n\s*\}/g, (m) => {
      keyframes.push(m);
      return `/*__KF${keyframes.length - 1}__*/`;
    });

    const kept: string[] = [];
    for (const rawLine of innerNoKeyframes.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0) {
        kept.push(rawLine);
        continue;
      }
      const legal =
        line.startsWith("--") ||
        line.startsWith("/*") ||
        line.startsWith("*") ||
        // continuation of a multi-line custom property value
        /^[^{}@:]+[;,)]$/.test(line);
      if (legal) {
        kept.push(rawLine);
      } else {
        removed.push(line.slice(0, 80));
      }
    }

    let rebuilt = kept.join("\n");
    rebuilt = rebuilt.replace(/\/\*__KF(\d+)__\*\//g, (_m, i) => keyframes[Number(i)] ?? "");

    if (rebuilt !== inner) {
      result = result.slice(0, start) + rebuilt + result.slice(end);
      rx.lastIndex = start + rebuilt.length;
    } else {
      rx.lastIndex = end;
    }
  }

  return { out: result, removed };
}

export function fixCssEscapes(files: ProjectFile[]): CssEscapeFixResult {
  const notes: string[] = [];
  const out = files.map((f) => {
    if (!f.path.toLowerCase().endsWith(".css")) return f;

    const unescaped = unescapeLiterals(f.content);
    const themed = sanitizeThemeBlocks(unescaped.out);

    if (unescaped.count === 0 && themed.removed.length === 0) return f;

    if (unescaped.count > 0) {
      notes.push(`css-escape: decoded ${unescaped.count} literal escape(s) in ${f.path}`);
    }
    if (themed.removed.length > 0) {
      notes.push(
        `css-escape: removed ${themed.removed.length} illegal line(s) from @theme in ${f.path} (${themed.removed
          .slice(0, 2)
          .join(" | ")})`,
      );
    }
    return { ...f, content: themed.out };
  });

  return { files: out, notes };
}
