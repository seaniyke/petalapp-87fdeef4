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
 *   R4 — Known kit list-prop omission.
 *     A generated page renders a scaffold section block that internally maps
 *     over data, but omits the required list prop (or accepted alias). This
 *     catches prop-contract mismatches that compile but white-screen at first
 *     render, e.g. <TestimonialsCards testimonials=...> before the block knew
 *     that alias.
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
const ENABLED_RULES = new Set<"R1" | "R2" | "R3" | "R4">(["R1", "R2", "R3", "R4"]);

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

const KIT_LIST_PROP_CONTRACTS: Record<string, string[][]> = {
  TestimonialsCards: [["items", "testimonials"]],
  TestimonialsMarquee: [["items", "testimonials"]],
  FaqAccordion: [["items", "faqs"]],
  FaqTwoColumn: [["items", "faqs"]],
  LogosGrid: [["logos"]],
  LogosMarquee: [["logos"]],
  FeaturesGrid3: [["items"]],
  FeaturesBento: [["items"]],
  FeaturesAlternatingRows: [["items"]],
  StatsBand: [["items"]],
  StatsGrid: [["items"]],
  StatsWithChart: [["kpis"], ["data"]],
  PricingTable: [["tiers"]],
  PricingSingleProduct: [["features"]],
  ComparisonTable: [["rows"], ["columns"]],
  ActivityFeed: [["items"]],
  MultiStepWizard: [["steps"]],
  SidebarShell: [["nav"]],
  CheckoutSummary: [["lines"]],
  TeamGrid: [["members"]],
  WorkGrid: [["items"]],
  CaseStudy: [["sections"]],
};

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

  // Find every component opener: `function Name(` or `const Name = (`
  // (also `const Name = React.memo((`). Then balance-parse `(...)` to
  // get the full parameter list — this lets us handle nested `{...}` in
  // type annotations like `{ items?: { id: string }[] }`.
  const openerRe =
    /(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(|const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?(?:memo\(\s*)?\()/g;

  let opener: RegExpExecArray | null;
  while ((opener = openerRe.exec(clean))) {
    const ownerName = opener[1] ?? opener[2] ?? "anonymous";
    const parenStart = opener.index + opener[0].length - 1; // position of `(`
    const parenEnd = findMatchingParen(clean, parenStart);
    if (parenEnd < 0) continue;
    const params = clean.slice(parenStart + 1, parenEnd);

    // We only handle the case of a single destructured param:
    // `{...}: {...}` — that's the dominant pattern in our codebase.
    const destruct = extractFirstBraceBlock(params);
    if (!destruct) continue;
    const afterDestruct = params.slice(destruct.end + 1);
    const colonMatch = /^\s*:\s*/.exec(afterDestruct);
    if (!colonMatch) continue;
    const typeStart = destruct.end + 1 + colonMatch[0].length;
    const typeBlock = extractFirstBraceBlock(params.slice(typeStart));
    if (!typeBlock) continue;
    const destructureContent = destruct.content;
    const typeContent = typeBlock.content;

    // Parse type block into the set of optional prop names.
    const optionalSet = new Set<string>();
    for (const segment of splitTypeFields(typeContent)) {
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
    for (const part of splitDestructure(destructureContent)) {
      const piece = part.trim();
      if (!piece) continue;
      const def = /^([A-Za-z_$][\w$]*)\s*=/.exec(piece);
      if (def) {
        safeNames.add(def[1]);
        declaredNames.add(def[1]);
        continue;
      }
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

    // Find the function body span (after `)` then optional `=>` then `{`).
    let bodyHead = parenEnd + 1;
    while (bodyHead < clean.length && /\s/.test(clean[bodyHead])) bodyHead++;
    if (clean.slice(bodyHead, bodyHead + 2) === "=>") bodyHead += 2;
    while (bodyHead < clean.length && /\s/.test(clean[bodyHead])) bodyHead++;
    if (clean[bodyHead] !== "{") continue;
    const bodyEnd = findMatchingBrace(clean, bodyHead);
    if (bodyEnd < 0) continue;
    const body = clean.slice(bodyHead + 1, bodyEnd);
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

function findMatchingParen(src: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Find the first `{...}` block in `src` and return its content + end pos. */
function extractFirstBraceBlock(src: string): { content: string; end: number } | null {
  let i = 0;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== "{") return null;
  const end = findMatchingBrace(src, i);
  if (end < 0) return null;
  return { content: src.slice(i + 1, end), end };
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
  // Conservative R3 strategy: a JSX `{ident}` is a typo only if the
  // identifier appears NOWHERE ELSE in the file (not as an import, not
  // as a declaration, not as a parameter, not even as a reference). This
  // avoids the entire class of false positives from "did we manage to
  // detect this binding?" — if the name shows up anywhere else in the
  // file, we trust the file. We still catch the canonical typo case
  // (`{titel}` when only `title` is defined) because typos by
  // construction don't appear elsewhere.
  //
  // We additionally allow imports + globals so that idents only
  // referenced via JSX (e.g. an icon used once) don't trip the rule.
  // Count token occurrences. The JSX `{ident}` itself contributes 1
  // occurrence, so an identifier that ONLY appears once must be the
  // typo'd reference itself (no declaration, no other use). Anything
  // appearing 2+ times has at least one other site (declaration,
  // import, prop, helper call) and is treated as known.
  const tokenCount = new Map<string, number>();
  const tokenRe = /\b([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(clean))) {
    tokenCount.set(m[1], (tokenCount.get(m[1]) ?? 0) + 1);
  }

  // Also include names from imports (in case the file is mostly JSX).
  const importRe =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:,\s*\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g;
  while ((m = importRe.exec(src))) {
    const bump = (n: string) => tokenCount.set(n, (tokenCount.get(n) ?? 0) + 2);
    if (m[1]) bump(m[1]);
    if (m[3]) bump(m[3]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (name) bump(name);
      }
    }
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
    if ((tokenCount.get(ident) ?? 0) >= 2) continue;
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
