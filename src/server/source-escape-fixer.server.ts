/**
 * Deterministic repair for AI-generated *source* files (.ts/.tsx/.js/.jsx)
 * that contain literal escape sequences where real whitespace belongs.
 *
 * Failure mode seen in production (jewelry app, build cb7748f1…):
 *
 *   const team = [
 *     { name: "Rhys Sterling",\n    role: "Master Jeweler", },
 *   ];
 *
 * The model emitted the two characters `\` + `n` — a JSON escape that was
 * never decoded — *between* tokens. esbuild aborts the whole build with
 * `ERROR: Syntax error "n"`, the deploy fails, and Petal burns auto-fix
 * attempts on a problem no LLM edit can reliably see.
 *
 * The repair is purely mechanical and provably safe: we walk the file with a
 * tiny scanner that tracks string / template / comment / regex state, and we
 * only rewrite a `\n` (or `\r`, `\t`) when it sits in *code* position, where
 * it can never be a valid escape. Escapes inside string and template
 * literals are left completely untouched.
 */

import type { ProjectFile } from "./generate.server";

export interface SourceEscapeFixResult {
  files: ProjectFile[];
  notes: string[];
}

const SOURCE_RX = /\.(tsx?|jsx?|mts|cts)$/i;

/** Replace literal `\n`/`\r`/`\t` pairs that occur outside any literal. */
export function unescapeCodePositions(src: string): { out: string; count: number } {
  let out = "";
  let count = 0;
  let i = 0;
  const n = src.length;

  type State = "code" | "sq" | "dq" | "tpl" | "line" | "block" | "regex" | "class";
  let state: State = "code";
  // Template literals can nest `${ … }` back into code position.
  const tplStack: number[] = [];
  let braceDepth = 0;
  // Last significant (non-whitespace) code character — decides whether a `/`
  // starts a regex literal or is a division operator.
  let lastSignificant = "";

  /** `/` starts a regex when the previous token cannot end an expression. */
  function regexCanStartHere(): boolean {
    if (lastSignificant === "") return true;
    return !/[A-Za-z0-9_$)\]}'"`]/.test(lastSignificant);
  }

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (state === "code") {
      if (ch === "\\" && (next === "n" || next === "r" || next === "t")) {
        out += next === "t" ? "  " : "\n";
        count++;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "/") {
        state = "line";
        out += ch;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        out += ch;
        i++;
        continue;
      }
      // Regex literal: `/\n$/`, `/language-(\w+)/g`. Escapes inside are REAL
      // regex escapes — unescaping them corrupts the file (this is the
      // `const text = String(children).replace(/\n$/, "")` crash).
      if (ch === "/" && regexCanStartHere()) {
        state = "regex";
        out += ch;
        i++;
        continue;
      }
      if (ch === "'") state = "sq";
      else if (ch === '"') state = "dq";
      else if (ch === "`") {
        state = "tpl";
        tplStack.push(braceDepth);
      } else if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        if (tplStack.length > 0 && tplStack[tplStack.length - 1] === braceDepth) {
          // Closing a `${ … }` inside a template literal.
          tplStack.pop();
          state = "tpl";
        }
      }
      if (!/\s/.test(ch)) lastSignificant = ch;
      out += ch;
      i++;
      continue;
    }

    if (state === "regex" || state === "class") {
      // An unterminated regex can never span a line in valid source — if we
      // hit a newline the `/` was division after all, so snap back to code.
      if (ch === "\n") {
        state = "code";
        lastSignificant = "";
        out += ch;
        i++;
        continue;
      }
      if (ch === "\\" && i + 1 < n) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (state === "regex" && ch === "[") state = "class";
      else if (state === "class" && ch === "]") state = "regex";
      else if (state === "regex" && ch === "/") {
        state = "code";
        lastSignificant = "/";
        out += ch;
        i++;
        // Consume flags so `g`/`i` don't look like an identifier boundary.
        while (i < n && /[a-z]/.test(src[i])) {
          out += src[i];
          lastSignificant = src[i];
          i++;
        }
        continue;
      }
      out += ch;
      i++;
      continue;
    }


    if (state === "line") {
      out += ch;
      if (ch === "\n") state = "code";
      i++;
      continue;
    }

    if (state === "block") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 2;
        state = "code";
        continue;
      }
      i++;
      continue;
    }

    // A single- or double-quoted string can NEVER span a newline in valid
    // JS/TS. If we hit one while "inside" a quote, the quote was not a string
    // at all — almost always an apostrophe in JSX text ("Rhys's workshop") or
    // inside a comment. Snap back to code position, otherwise the scanner
    // stays desynced for the rest of the file and every real `\n`-in-code
    // below it is skipped. That desync is exactly why the jewelry build kept
    // failing on `name: "…",\n    role: …` even with this pass enabled.
    if ((state === "sq" || state === "dq") && (ch === "\n" || ch === "\r")) {
      state = "code";
      out += ch;
      i++;
      continue;
    }

    // Inside a literal — copy escapes verbatim.
    if (ch === "\\" && i + 1 < n) {
      out += ch + next;
      i += 2;
      continue;
    }

    if (state === "sq" && ch === "'") state = "code";
    else if (state === "dq" && ch === '"') state = "code";
    else if (state === "tpl") {
      if (ch === "`") {
        state = "code";
        tplStack.pop();
      } else if (ch === "$" && next === "{") {
        out += ch + next;
        i += 2;
        tplStack.push(braceDepth);
        braceDepth++;
        state = "code";
        continue;
      }
    }
    out += ch;
    i++;

  }

  return { out, count };
}

export function fixSourceEscapes(files: ProjectFile[]): SourceEscapeFixResult {
  const notes: string[] = [];
  const out = files.map((f) => {
    if (!SOURCE_RX.test(f.path)) return f;
    // Cheap bail-out: no literal backslash-n anywhere.
    if (!/\\[nrt]/.test(f.content)) return f;
    const fixed = unescapeCodePositions(f.content);
    if (fixed.count === 0 || fixed.out === f.content) return f;
    notes.push(
      `source-escapes: unescaped ${fixed.count} literal \\n/\\t sequence(s) in ${f.path}`,
    );
    return { ...f, content: fixed.out };
  });
  return { files: out, notes };
}
