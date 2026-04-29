/**
 * Render-risk linter — Tier 2.8.
 *
 * Catches the top white-screen render-crash patterns that pass syntax
 * (Tier 2.7) but throw at first render. Three rules, each conservative
 * enough to ship as a hard-feed-into-autofix gate without false-positiving
 * clean turns.
 *
 * Why deterministic instead of an actual render mount:
 *   - Cloudflare Workers can't run jsdom or eval imported modules.
 *   - The bug class is mostly semantic; an AST-shaped scan catches it.
 *   - Runs in <50ms; no LLM cost; no new infra.
 *
 * RULES (each emits a LocalIssue with kind="render-risk"):
 *
 *   R1 — Optional-prop crash.
 *     A prop typed as optional (`prop?:` or `prop: T | undefined | null`)
 *     is destructured WITHOUT a default and then accessed via
 *     `.length` / `.map` / `.filter` / `.forEach` / `.find` / `.reduce` /
 *     `.slice` / `.some` / `.every` / `.includes` / etc. somewhere
 *     in the function body, WITHOUT `?.` chaining or an `if (prop)` /
 *     `prop &&` guard before the access.
 *     Example caught:
 *       function X({ items }: { items?: T[] }) { return items.map(...) }
 *
 *   R2 — Conditional hooks.
 *     A React hook (use*) is called from within an `if`, `else`, or
 *     ternary branch in a component body. Violates Rules of Hooks → React
 *     throws "Rendered fewer hooks than expected" on the next render.
 *
 *   R3 — JSX undeclared identifier.
 *     A `{ident}` expression in JSX references a name that is not
 *     declared anywhere in the file (no import, no local var, no prop,
 *     not a React/global). Catches typos like `{titel}` → `{title}`.
 *
 * SKIPS:
 *   - src/components/ui/ (scaffold)
 *   - src/integrations/   (scaffold)
 *   - src/components/examples/ (intentionally partial reference snippets)
 *   - non-tsx/jsx files (no JSX → most rules don't apply)
 *
 * Each rule is independently disable-able for emergency rollback by
 * editing the ENABLED_RULES set below.
 */

import type { LocalIssue } from "@/server/local-verifier";

/** Limit which rules fire. Edit to disable individual rules in production. */
const ENABLED_RULES = new Set<"R1" | "R2" | "R3">(["R1", "R2", "R3"]);

const SCANNABLE = /\.(tsx|jsx)$/;
// Skip the same scaffold paths the other verifiers skip.
const SKIP_PREFIXES = [
  "src/components/ui/",
  "src/integrations/",
  "src/components/examples/",
];

const ARRAY_METHODS = [
  "length",
  "map",
  "filter",
  "forEach",
  "find",
  "reduce",
  "slice",
  "some",
  "every",
  "includes",
  "indexOf",
  "join",
  "concat",
  "flat",
  "flatMap",
  "sort",
  "reverse",
];

const HOOKS = [
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useReducer",
  "useLayoutEffect",
  "useImperativeHandle",
  "useTransition",
  "useDeferredValue",
  "useSyncExternalStore",
  "useId",
];

/** Strip strings and comments so regex scans aren't poisoned by literals. */
function stripStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += " ";
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          out += " ${";
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            out += src[i];
            i++;
          }
          continue;
        }
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// =============================================================================
// R1 — Optional-prop crash
// =============================================================================

interface OptionalProp {
  /** Name as it appears in the body after destructure (alias if renamed). */
  name: string;
  /** Function/component name (best-effort) for the issue detail. */
  ownerName: string;
}

/**
 * Find function components that destructure props with an inline type
 * annotation marking at least one prop as optional.
 *
 * Matches:
 *   function X({ a, b }: { a?: T; b: U })           → a is optional
 *   function X({ items = [] }: { items?: T[] })     → items has default → SAFE
 *   const X = ({ items }: { items?: T[] }) => ...   → items is optional
 *
 * Conservative: only inspects inline object types right after the
 * destructure. `interface Props { x?: T }` separated declarations are
 * intentionally skipped (would require cross-binding analysis and produce
 * false positives on prop spreads).
 */
function findOptionalDestructuredProps(clean: string): {
  props: OptionalProp[];
  /** Body slice for each owner so we can scan it for unsafe access. */
  bodyByOwner: Map<string, string>;
} {
  const props: OptionalProp[] = [];
  const bodyByOwner = new Map<string, string>();

  // Match either `function Name({...}: { ... }) { body }` OR
  // `const Name = ({...}: { ... }) => { body }` / `=> (`.
  const re =
    /(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(\s*\{([^}]*)\}\s*:\s*\{([^}]*)\}\s*\)|const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?(?:memo\(\s*)?\(\s*\{([^}]*)\}\s*:\s*\{([^}]*)\}\s*\)\s*=>)/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const ownerName = m[1] ?? m[4] ?? "anonymous";
    const destructure = (m[2] ?? m[5] ?? "").trim();
    const typeBlock = (m[3] ?? m[6] ?? "").trim();
    if (!destructure || !typeBlock) continue;

    // Parse type block into the set of optional prop names.
    const optionalSet = new Set<string>();
    for (const segment of splitTypeFields(typeBlock)) {
      const seg = segment.trim();
      if (!seg) continue;
      const optMark = /^([A-Za-z_$][\w$]*)\s*\?\s*:/.exec(seg);
      if (optMark) {
        optionalSet.add(optMark[1]);
        continue;
      }
      const nameMatch = /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/s.exec(seg);
      if (nameMatch) {
        const valueType = nameMatch[2];
        if (/\|\s*(?:undefined|null)\b/.test(valueType)) {
          optionalSet.add(nameMatch[1]);
        }
      }
    }
    if (optionalSet.size === 0) continue;

    // Parse destructure for `prop` vs `prop = default` vs `prop: alias`.
    const safeNames = new Set<string>();
    const aliases = new Map<string, string>();
    const declaredNames = new Set<string>();
    for (const part of splitDestructure(destructure)) {
      const piece = part.trim();
      if (!piece) continue;
      // `name = expr` → safe regardless of optionality.
      const def = /^([A-Za-z_$][\w$]*)\s*=/.exec(piece);
      if (def) {
        safeNames.add(def[1]);
        declaredNames.add(def[1]);
        continue;
      }
      // `name: alias` → track alias as the name we'll see in body. Also
      // accept `name: alias = default`.
      const renameDef =
        /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*=/.exec(piece);
      if (renameDef) {
        aliases.set(renameDef[1], renameDef[2]);
        safeNames.add(renameDef[2]);
        declaredNames.add(renameDef[2]);
        continue;
      }
      const rename = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/.exec(piece);
      if (rename) {
        aliases.set(rename[1], rename[2]);
        declaredNames.add(rename[2]);
        continue;
      }
      const bare = /^([A-Za-z_$][\w$]*)\s*$/.exec(piece);
      if (bare) declaredNames.add(bare[1]);
    }

    // Find the function body span.
    const bodyStart = findFunctionBodyStart(clean, m.index + m[0].length);
    if (bodyStart < 0) continue;
    const bodyEnd = findMatchingBrace(clean, bodyStart);
    if (bodyEnd < 0) continue;
    const body = clean.slice(bodyStart + 1, bodyEnd);
    bodyByOwner.set(ownerName, body);

    for (const optName of optionalSet) {
      const effectiveName = aliases.get(optName) ?? optName;
      if (safeNames.has(effectiveName)) continue;
      if (!declaredNames.has(effectiveName)) continue;
      props.push({ name: effectiveName, ownerName });
    }
  }

  return { props, bodyByOwner };
}

/** Split a type-block body on `;` or `,` while respecting nested generics/braces. */
function splitTypeFields(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === "{" || c === "<" || c === "(") depth++;
    else if (c === "}" || c === ">" || c === ")") depth--;
    else if (depth === 0 && (c === ";" || c === ",")) {
      out.push(block.slice(start, i));
      start = i + 1;
    }
  }
  if (start < block.length) out.push(block.slice(start));
  return out;
}

/** Same logic but for destructure (uses `,` only). */
function splitDestructure(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === "{" || c === "<" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ">" || c === ")" || c === "]") depth--;
    else if (depth === 0 && c === ",") {
      out.push(block.slice(start, i));
      start = i + 1;
    }
  }
  if (start < block.length) out.push(block.slice(start));
  return out;
}

/** Skip whitespace + arrow body markers to find `{` of function body. */
function findFunctionBodyStart(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === "{") return i;
  return -1;
}

function findMatchingBrace(src: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * In the body of an at-risk component, look for `propName.<arrayMethod>`
 * WITHOUT optional chaining and not preceded shortly by a guard.
 * "Guard" = `if (propName`, `propName &&`, `propName?.`, `!propName ?`,
 * or `propName ?? [...` / `propName ?? {...`.
 */
function bodyHasUnsafeAccess(body: string, propName: string): { method: string } | null {
  const escaped = escapeRe(propName);
  for (const method of ARRAY_METHODS) {
    const re = new RegExp(
      `(?<![A-Za-z0-9_$?])${escaped}\\.${method}\\b`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      // Coarse guard check in the 200 chars before the match.
      const before = body.slice(Math.max(0, m.index - 200), m.index);
      const guardRe = new RegExp(
        `(?:if\\s*\\(\\s*${escaped}\\b|${escaped}\\s*&&|${escaped}\\?\\.|!\\s*${escaped}\\s*\\?|${escaped}\\s*\\?\\?\\s*[\\[{"'\`])`,
      );
      if (guardRe.test(before)) continue;
      // Common safe pattern: early-return guard `if (!prop) return ...`
      const earlyReturn = new RegExp(
        `if\\s*\\(\\s*!\\s*${escaped}\\s*\\)\\s*return\\b`,
      );
      if (earlyReturn.test(before)) continue;
      return { method };
    }
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// R2 — Conditional hooks
// =============================================================================

/**
 * Look for `useFoo(...)` calls whose nearest preceding meaningful token
 * is a conditional opener. Conservative: false-negatives are acceptable;
 * false-positives are not.
 *
 * Heuristic: in the 200 chars before the hook call, find the latest
 * `if (`, `} else`, or `?` (ternary). If that conditional opener is more
 * recent than the latest `{` that would open a fresh function body and
 * also more recent than the latest `;` that ends a statement, the hook
 * is sitting directly inside the conditional branch.
 */
function findConditionalHooks(clean: string): { name: string; line: number; reason: string }[] {
  const issues: { name: string; line: number; reason: string }[] = [];
  const hookRe = new RegExp(`\\b(${HOOKS.join("|")})\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = hookRe.exec(clean))) {
    const idx = m.index;
    const before = clean.slice(Math.max(0, idx - 200), idx);
    const lastIfIdx = Math.max(
      before.lastIndexOf("if ("),
      before.lastIndexOf("if("),
    );
    const lastElseIdx = before.lastIndexOf("} else");
    const lastTernaryIdx = before.lastIndexOf("?");
    const lastBraceIdx = before.lastIndexOf("{");
    const lastSemiIdx = before.lastIndexOf(";");

    const guardIdx = Math.max(lastIfIdx, lastElseIdx, lastTernaryIdx);
    if (guardIdx < 0) continue;
    // If a fresh `{` opened after the guard (e.g. nested function or
    // body of `if (...) { ... }` already entered), the hook is no longer
    // in conditional position from the parent's perspective. We only
    // want hooks that sit BARE in the conditional expression / branch.
    if (lastBraceIdx > guardIdx) continue;
    // Statement separator after the guard means we've already exited it.
    if (lastSemiIdx > guardIdx) continue;

    const line = clean.slice(0, idx).split("\n").length;
    let reason = "called inside a conditional";
    if (lastIfIdx === guardIdx) reason = "called inside an `if` branch";
    else if (lastElseIdx === guardIdx) reason = "called inside an `else` branch";
    else if (lastTernaryIdx === guardIdx) reason = "called inside a ternary expression";

    issues.push({ name: m[1], line, reason });
  }
  return issues;
}

// =============================================================================
// R3 — JSX undeclared identifier
// =============================================================================

/**
 * Collect every name declared in the file: imports, function/const/let/var
 * declarations, parameters, destructured names. If a JSX expression
 * references a bare identifier that isn't declared, isn't a React/global,
 * flag it.
 *
 * Conservative: only single-identifier expressions (`{foo}`), not member
 * expressions (`{foo.bar}`) or calls. This catches typos without trying
 * to resolve any complex chain.
 */
function findUndeclaredJsxIdentifiers(src: string, clean: string): string[] {
  const declared = new Set<string>();

  // Imports.
  const importRe =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:,\s*\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    if (m[1]) declared.add(m[1]);
    if (m[3]) declared.add(m[3]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (name) declared.add(name);
      }
    }
  }

  // Top-level + nested declarations.
  const declRe =
    /(?:^|\n|;|\{|\(|,)\s*(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(clean))) declared.add(m[1]);

  // Function parameters: `function name(...)`, `=> (...)`, `(...) =>`.
  const fnParamRe = /(?:function\s+[\w$]*\s*|=\s*)\(([^)]*)\)/g;
  while ((m = fnParamRe.exec(clean))) {
    extractIdents(m[1]).forEach((n) => declared.add(n));
  }
  // Single-arg arrow: `a => ...`.
  const arrowSingleRe = /\b([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowSingleRe.exec(clean))) declared.add(m[1]);

  // Destructured names anywhere: `{ a, b: c, d = 1 }` and `[a, b]`.
  const destObjRe = /\{([^{}]*)\}/g;
  while ((m = destObjRe.exec(clean))) {
    extractIdents(m[1]).forEach((n) => declared.add(n));
  }
  const destArrRe = /\[([^\[\]]*)\]/g;
  while ((m = destArrRe.exec(clean))) {
    extractIdents(m[1]).forEach((n) => declared.add(n));
  }

  // Globals + React + common browser APIs that don't need declaring.
  const builtins = new Set([
    "React",
    "Fragment",
    "Children",
    "console",
    "window",
    "document",
    "navigator",
    "globalThis",
    "process",
    "Math",
    "Date",
    "JSON",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "Error",
    "Promise",
    "Set",
    "Map",
    "Symbol",
    "undefined",
    "null",
    "true",
    "false",
    "NaN",
    "Infinity",
    "this",
    "super",
    "arguments",
    "void",
  ]);

  // JSX expressions of the shape `>{ident}`. We restrict to JSX context
  // (preceded by `>`) to avoid object literals like `{ foo }`.
  const jsxExprRe = />[^<]*?\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  const missing = new Set<string>();
  while ((m = jsxExprRe.exec(clean))) {
    const ident = m[1];
    if (declared.has(ident)) continue;
    if (builtins.has(ident)) continue;
    missing.add(ident);
  }
  return [...missing];
}

function extractIdents(block: string): string[] {
  const out: string[] = [];
  // Strip nested `{...}` (rare in destructure) by collapsing them.
  const flat = block.replace(/\{[^{}]*\}/g, "");
  for (const part of flat.split(",")) {
    const piece = part.trim().split(/\s*=/)[0]; // drop default
    const seg = piece.split(/\s*:\s*/).pop() ?? piece; // alias → use alias
    const m = /^([A-Za-z_$][\w$]*)/.exec(seg);
    if (m) out.push(m[1]);
  }
  return out;
}

// =============================================================================
// Entry point
// =============================================================================

export function lintRenderRisks(
  files: { path: string; content: string }[],
  changedPaths: string[],
): LocalIssue[] {
  const changed = new Set(changedPaths);
  const issues: LocalIssue[] = [];

  for (const f of files) {
    if (!changed.has(f.path)) continue;
    if (!SCANNABLE.test(f.path)) continue;
    if (SKIP_PREFIXES.some((p) => f.path.startsWith(p))) continue;

    const clean = stripStringsAndComments(f.content);

    // R1 — optional-prop crash.
    if (ENABLED_RULES.has("R1")) {
      const { props, bodyByOwner } = findOptionalDestructuredProps(clean);
      for (const p of props) {
        const body = bodyByOwner.get(p.ownerName) ?? "";
        const hit = bodyHasUnsafeAccess(body, p.name);
        if (hit) {
          issues.push({
            path: f.path,
            kind: "render-risk",
            detail: `<${p.ownerName}>: prop "${p.name}" is optional but accessed via .${hit.method} without ?. or default — will throw on render`,
          });
        }
      }
    }

    // R2 — conditional hooks.
    if (ENABLED_RULES.has("R2")) {
      for (const issue of findConditionalHooks(clean)) {
        issues.push({
          path: f.path,
          kind: "render-risk",
          detail: `${issue.name} ${issue.reason} (line ${issue.line}) — violates Rules of Hooks`,
        });
      }
    }

    // R3 — undeclared JSX identifiers.
    if (ENABLED_RULES.has("R3")) {
      const missing = findUndeclaredJsxIdentifiers(f.content, clean);
      if (missing.length > 0) {
        issues.push({
          path: f.path,
          kind: "render-risk",
          detail: `JSX references undeclared identifier(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
        });
      }
    }
  }

  return issues;
}
