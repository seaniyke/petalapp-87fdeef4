/**
 * Deterministic repair for JSX attributes whose value is an unbraced literal.
 *
 * Production failure (App.tsx:36):
 *
 *   <FooterColumns columns=[ { title: "Product" }, … ] />
 *                          ^ esbuild: Expected "{" but found "["
 *
 * JSX attribute values may only be a string literal or a `{…}` expression
 * container. The model occasionally drops the braces around array/object/
 * number/boolean literals. The shape is unambiguous, so we heal it
 * mechanically before esbuild ever sees the file.
 *
 * Handled shapes:
 *   prop=[ … ]        → prop={[ … ]}
 *   prop={ … } (ok)   → untouched
 *   prop=42           → prop={42}
 *   prop=true|false|null → prop={true}
 */

import type { ProjectFile } from "./generate.server";

export interface JsxAttrLiteralFixResult {
  files: ProjectFile[];
  notes: string[];
}

const SOURCE_RX = /\.(tsx|jsx)$/i;

/** Find the index of the bracket matching `src[open]`, skipping strings/comments. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  const stack: string[] = [pairs[src[open]]];
  let i = open + 1;
  while (i < src.length && stack.length > 0) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

function fixOne(src: string): { content: string; count: number } {
  let out = src;
  let count = 0;

  // 1. prop=[ … ]  → prop={[ … ]}
  //    Scan repeatedly; each rewrite shifts indices.
  const attrArray = /(<[A-Za-z][^<>]*?\s)([A-Za-z_$][\w$]*)\s*=\s*\[/;
  // The regex above can't span multi-line tags reliably, so use a looser
  // line-anchored form: an attribute-looking `name=[` at the start of a line
  // or after whitespace, not preceded by `=`, `!`, `<`, `>` or an identifier.
  const loose = /(^|[\s{(,])([A-Za-z_$][\w$]*)\s*=\s*\[/gm;
  void attrArray;

  for (let guard = 0; guard < 200; guard++) {
    loose.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    let found: RegExpExecArray | null = null;
    while ((m = loose.exec(out))) {
      // Ignore comparisons / assignments of array literals in plain TS
      // (`const x = [` has `=` preceded by an identifier + space but is
      // matched by `const`… so require the previous token isn't a keyword).
      const before = out.slice(Math.max(0, m.index - 12), m.index + m[1].length);
      if (/\b(const|let|var|return|of|in)\s*$/.test(before)) continue;
      // Only heal when we're inside a JSX tag: walk back to the nearest
      // unclosed `<Tag`.
      const head = out.lastIndexOf("<", m.index);
      if (head === -1) continue;
      const between = out.slice(head, m.index);
      if (!/^<[A-Za-z][\w.$-]*[\s\S]*$/.test(between) || between.includes(">")) continue;
      found = m;
      break;
    }
    if (!found) break;

    const openIdx = out.indexOf("[", found.index + found[1].length + found[2].length);
    const closeIdx = matchBracket(out, openIdx);
    if (closeIdx === -1) break;
    out =
      out.slice(0, openIdx) +
      "{" +
      out.slice(openIdx, closeIdx + 1) +
      "}" +
      out.slice(closeIdx + 1);
    count++;
  }

  // 2. prop=42 / prop=true / prop=false / prop=null inside a JSX tag.
  //    The lazy tag-prefix can skip over an earlier unbraced attribute, so
  //    re-run until the file stops changing.
  const NUM_ATTR =
    /(<[A-Za-z][\w.$-]*(?:\s+[^<>]*?)?\s)([A-Za-z_$][\w$]*)=(-?\d+(?:\.\d+)?|true|false|null)(?=[\s/>])/g;
  for (let guard = 0; guard < 50; guard++) {
    const before = out;
    out = out.replace(NUM_ATTR, (_full, head: string, name: string, value: string) => {
      count++;
      return `${head}${name}={${value}}`;
    });
    if (out === before) break;
  }

  return { content: out, count };
}

export function fixJsxAttrLiterals(files: ProjectFile[]): JsxAttrLiteralFixResult {
  const notes: string[] = [];
  let total = 0;
  let touched = 0;

  const next = files.map((f) => {
    if (!SOURCE_RX.test(f.path)) return f;
    if (!/=\s*\[|=(?:-?\d|true|false|null)/.test(f.content)) return f;
    const { content, count } = fixOne(f.content);
    if (count === 0 || content === f.content) return f;
    total += count;
    touched++;
    return { ...f, content };
  });

  if (total > 0) {
    notes.push(
      `jsx-attr-literals: wrapped ${total} unbraced JSX attribute value(s) across ${touched} file(s)`,
    );
  }

  return { files: next, notes };
}
