/**
 * Plan #4 — AST-level diff edits (labs-flagged).
 *
 * Tiny, focused set of structural edits that target named JS/TS constructs
 * by identifier or anchor instead of by exact-text snippet. This is a
 * stricter, less-flaky alternative to `replace` ops for the common cases
 * where a `replace` is fragile because the surrounding text drifts:
 *
 *   - replace-export      → swap the body of `export const|function NAME`
 *   - replace-function    → swap the body of `function NAME(...)`
 *   - add-import          → idempotently add `import X from "src"` at top
 *   - remove-import       → remove a named-or-default import line
 *   - replace-jsx-block   → swap a JSX subtree anchored by
 *                           `data-petal-block="ID"` attribute
 *
 * Strategy: parse once with @babel/parser to find spans, then splice the
 * original source by character index. We never re-serialize the whole AST
 * — that would normalize formatting and produce noisy diffs.
 *
 * Behind labs flag `ast_patches`. If the flag is off, callers reject any
 * `ast-patch` op before we even get here, so this module is unreachable
 * in production until explicitly opted in. `keep-existing-expander.ts`
 * and the existing `replace` / `update` ops remain the default path.
 */

import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";

export type AstPatch =
  | { kind: "replace-export"; name: string; body: string }
  | { kind: "replace-function"; name: string; body: string }
  | { kind: "add-import"; specifier: string; from: string; default?: boolean }
  | { kind: "remove-import"; from: string }
  | { kind: "replace-jsx-block"; blockId: string; jsx: string };

const PARSER_OPTS: ParserOptions = {
  sourceType: "module",
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  errorRecovery: true,
  plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
};

interface Node {
  type: string;
  start?: number;
  end?: number;
  // permissive — we only read a few well-known fields
  [k: string]: unknown;
}

function parseSource(source: string): Node {
  return parse(source, PARSER_OPTS) as unknown as Node;
}

/** Apply patches to a single file's source. Returns updated source or throws
 *  a descriptive error the orchestrator can surface as a retry hint. */
export function applyAstPatches(source: string, patches: AstPatch[]): string {
  let out = source;
  for (const patch of patches) {
    out = applyOne(out, patch);
  }
  return out;
}

function applyOne(source: string, patch: AstPatch): string {
  switch (patch.kind) {
    case "replace-export":
      return replaceExport(source, patch.name, patch.body);
    case "replace-function":
      return replaceFunction(source, patch.name, patch.body);
    case "add-import":
      return addImport(source, patch.specifier, patch.from, Boolean(patch.default));
    case "remove-import":
      return removeImport(source, patch.from);
    case "replace-jsx-block":
      return replaceJsxBlock(source, patch.blockId, patch.jsx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementations
// ─────────────────────────────────────────────────────────────────────────────

function replaceExport(source: string, name: string, body: string): string {
  const ast = parseSource(source);
  const program = (ast as { program?: { body?: Node[] } }).program;
  const stmts = program?.body ?? [];
  for (const stmt of stmts) {
    if (stmt.type !== "ExportNamedDeclaration" && stmt.type !== "ExportDefaultDeclaration") continue;
    const decl = (stmt as { declaration?: Node }).declaration;
    if (!decl) continue;
    if (declMatchesName(decl, name)) {
      const start = stmt.start ?? -1;
      const end = stmt.end ?? -1;
      if (start < 0 || end < 0) break;
      return source.slice(0, start) + body + source.slice(end);
    }
  }
  throw new Error(`ast_patch: replace-export "${name}" not found`);
}

function replaceFunction(source: string, name: string, body: string): string {
  const ast = parseSource(source);
  const program = (ast as { program?: { body?: Node[] } }).program;
  const stmts = program?.body ?? [];
  for (const stmt of stmts) {
    let target: Node | null = null;
    if (stmt.type === "FunctionDeclaration") target = stmt;
    else if (
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
    ) {
      const d = (stmt as { declaration?: Node }).declaration;
      if (d && d.type === "FunctionDeclaration") target = stmt;
    } else if (stmt.type === "VariableDeclaration") {
      // const NAME = (props) => ...
      const decls = (stmt as { declarations?: Node[] }).declarations ?? [];
      const hit = decls.find((d) => {
        const id = (d as { id?: { name?: string } }).id;
        return id?.name === name;
      });
      if (hit) target = stmt;
    }
    if (!target) continue;
    if (target.type === "FunctionDeclaration") {
      const idName = (target as { id?: { name?: string } }).id?.name;
      if (idName !== name) continue;
    }
    const start = target.start ?? -1;
    const end = target.end ?? -1;
    if (start < 0 || end < 0) break;
    return source.slice(0, start) + body + source.slice(end);
  }
  throw new Error(`ast_patch: replace-function "${name}" not found`);
}

function declMatchesName(decl: Node, name: string): boolean {
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
    return (decl as { id?: { name?: string } }).id?.name === name;
  }
  if (decl.type === "VariableDeclaration") {
    const decls = (decl as { declarations?: Node[] }).declarations ?? [];
    return decls.some((d) => (d as { id?: { name?: string } }).id?.name === name);
  }
  return false;
}

function addImport(source: string, specifier: string, from: string, isDefault: boolean): string {
  // Idempotent: if the import already exists, no-op.
  const importLine = isDefault
    ? `import ${specifier} from "${from}";`
    : `import { ${specifier} } from "${from}";`;
  const ast = parseSource(source);
  const program = (ast as { program?: { body?: Node[] } }).program;
  const stmts = program?.body ?? [];

  // Look for existing import from the same source.
  for (const stmt of stmts) {
    if (stmt.type !== "ImportDeclaration") continue;
    const src = (stmt as { source?: { value?: string } }).source?.value;
    if (src !== from) continue;
    // `import type { Foo } from "x"` is erased at compile time — merging a
    // value specifier into it produces `undefined` at runtime. Leave it alone
    // and fall through to inserting a separate value import.
    if ((stmt as { importKind?: string }).importKind === "type") continue;
    const specs = (stmt as { specifiers?: Node[] }).specifiers ?? [];
    const already = specs.some((s) => {
      if (isDefault) return s.type === "ImportDefaultSpecifier";
      const local = (s as { local?: { name?: string } }).local?.name;
      return s.type === "ImportSpecifier" && local === specifier;
    });
    if (already) return source;

    // Merge into existing import line.
    const start = stmt.start ?? -1;
    const end = stmt.end ?? -1;
    if (start < 0 || end < 0) break;
    const original = source.slice(start, end);
    let merged = original;
    if (isDefault && !specs.some((s) => s.type === "ImportDefaultSpecifier")) {
      merged = original.replace(/^import\s+/, `import ${specifier}, `);
    } else if (!isDefault) {
      if (/\{[^}]*\}/.test(original)) {
        merged = original.replace(/\{([^}]*)\}/, (_m, inner) =>
          `{ ${inner.trim().replace(/,$/, "")}, ${specifier} }`,
        );
      } else {
        merged = original.replace(
          /^(import\s+[A-Za-z_$][\w$]*)\s+from/,
          `$1, { ${specifier} } from`,
        );
      }
    }
    // A bare side-effect import (`import "./x"`) matches neither shape above,
    // so `merged` comes back untouched. Silently returning it would drop the
    // requested specifier — fall through and add a real import line instead.
    if (merged !== original) return source.slice(0, start) + merged + source.slice(end);
    break;
  }

  // No existing import — insert after last top-level import, else at file start.
  let insertAt = 0;
  for (const stmt of stmts) {
    if (stmt.type === "ImportDeclaration") insertAt = Math.max(insertAt, stmt.end ?? insertAt);
  }
  const sep = source[insertAt] === "\n" ? "" : "\n";
  return source.slice(0, insertAt) + (insertAt > 0 ? "\n" : "") + importLine + sep + source.slice(insertAt);
}

function removeImport(source: string, from: string): string {
  const ast = parseSource(source);
  const program = (ast as { program?: { body?: Node[] } }).program;
  const stmts = program?.body ?? [];
  for (const stmt of stmts) {
    if (stmt.type !== "ImportDeclaration") continue;
    const src = (stmt as { source?: { value?: string } }).source?.value;
    if (src !== from) continue;
    const start = stmt.start ?? -1;
    let end = stmt.end ?? -1;
    if (start < 0 || end < 0) break;
    // Swallow the trailing newline so we don't leave a blank line.
    if (source[end] === "\n") end += 1;
    return source.slice(0, start) + source.slice(end);
  }
  // Idempotent — missing import is a no-op.
  return source;
}

function replaceJsxBlock(source: string, blockId: string, jsx: string): string {
  // We anchor purely on the textual attribute; the parser is overkill here
  // and gets cranky with partial fragments. The convention is that the
  // model adds `data-petal-block="ID"` to the OUTERMOST element of a region
  // it intends to re-edit later. We then swap the entire element (open
  // tag → close tag) with the new JSX.
  const attrRe = new RegExp(`data-petal-block=["']${escapeRe(blockId)}["']`);
  const attrMatch = attrRe.exec(source);
  if (!attrMatch) throw new Error(`ast_patch: replace-jsx-block anchor "${blockId}" not found`);

  // Walk back to find the `<` that opens this element.
  let openLt = attrMatch.index;
  while (openLt > 0 && source[openLt] !== "<") openLt -= 1;
  if (source[openLt] !== "<") throw new Error(`ast_patch: open "<" before anchor not found`);

  // Find the element's tag name.
  const tagMatch = /^<([A-Za-z][\w.-]*)/.exec(source.slice(openLt));
  if (!tagMatch) throw new Error(`ast_patch: malformed tag at anchor`);
  const tag = tagMatch[1];

  // Find the end of the opening tag.
  const opened = findTagEnd(source, openLt);
  if (!opened) throw new Error(`ast_patch: unterminated open tag`);
  let closeEnd = opened.end;

  if (!opened.selfClosing) {
    // Find the matching close tag, accounting for nested same-tag elements.
    //
    // The previous implementation advanced two independent regexes and
    // treated EVERY nested `<tag` as a depth increase — including
    // self-closing ones like `<div />`. Depth then never returned to zero and
    // the scan either threw or swallowed the rest of the file. Walk the
    // occurrences in a single ordered pass and ask each open tag whether it
    // actually closes itself.
    const tokenRe = new RegExp(`<(/?)${escapeRe(tag)}(?=[\\s/>])`, "g");
    tokenRe.lastIndex = closeEnd;
    let depth = 1;
    let token: RegExpExecArray | null;
    while ((token = tokenRe.exec(source)) !== null) {
      const isClose = token[1] === "/";
      const bounds = findTagEnd(source, token.index);
      if (!bounds) break;
      if (isClose) {
        depth -= 1;
        if (depth === 0) {
          closeEnd = bounds.end;
          break;
        }
      } else if (!bounds.selfClosing) {
        depth += 1;
      }
      tokenRe.lastIndex = bounds.end;
    }
    if (depth !== 0) throw new Error(`ast_patch: matching </${tag}> not found`);
  }

  return source.slice(0, openLt) + jsx + source.slice(closeEnd);
}

/**
 * Given the index of a `<`, return the index just past the matching `>` and
 * whether the tag closes itself. String-aware so a `>` inside an attribute
 * value (`title=">>"`), or a `/` inside a URL, doesn't end the tag early.
 */
function findTagEnd(source: string, ltIndex: number): { end: number; selfClosing: boolean } | null {
  let cursor = ltIndex + 1;
  let inStr: string | null = null;
  let braceDepth = 0;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (inStr) {
      if (ch === "\\") cursor += 1;
      else if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
    } else if (ch === "{") {
      // Expression container — `>` inside `onClick={() => x}` is not the end.
      braceDepth += 1;
    } else if (ch === "}") {
      if (braceDepth > 0) braceDepth -= 1;
    } else if (ch === ">" && braceDepth === 0) {
      let back = cursor - 1;
      while (back > ltIndex && /\s/.test(source[back])) back -= 1;
      return { end: cursor + 1, selfClosing: source[back] === "/" };
    }
    cursor += 1;
  }
  return null;
}


function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
