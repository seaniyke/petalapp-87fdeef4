/**
 * Local (deterministic) verifier — no model call, <5ms per file.
 *
 * Catches the failure mode our model-based verifier can miss:
 *   - Truncated streams (file ends mid-JSX or mid-statement)
 *   - Unbalanced component-level JSX tags like <Card>...</Card>
 *   - Unbalanced braces/parens at file scope
 *
 * This runs BEFORE the model verifier and acts as a hard trigger for
 * post-stream autofix recovery. Treat its findings as ground truth — if
 * the brace count is off, the file will not compile.
 */

export interface LocalIssue {
  path: string;
  kind:
    | "truncation"
    | "jsx"
    | "braces"
    | "undefined"
    | "lazy-export"
    | "unterminated-string"
    | "missing-dep"
    | "missing-sibling"
    | "missing-export"
    | "parse"
    | "oversize"
    | "render-risk"
    | "rls-sanity";
  detail: string;
}

export interface LocalVerdict {
  ok: boolean;
  issues: LocalIssue[];
}

const SCANNABLE = /\.(tsx?|jsx?)$/;

/** Strip strings/comments so brace counting isn't poisoned by literals. */
function stripNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // line comment
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // block comment
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string literals
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i += 2;
        else if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          // template expression — keep braces balanced, recurse-lite
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
        } else i++;
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

/** Count component-style JSX tags: <Card> vs </Card>. Lowercase tags (html) are ignored
 *  because they're rarely the truncation point and have many self-closing edge cases. */
function jsxTagBalance(src: string): { open: Map<string, number>; close: Map<string, number> } {
  const open = new Map<string, number>();
  const close = new Map<string, number>();
  // Self-closing: <Foo ... />
  const selfClose = /<([A-Z][A-Za-z0-9_]*)\b[^<>]*\/>/g;
  const opening = /<([A-Z][A-Za-z0-9_]*)\b[^<>]*?>/g;
  const closing = /<\/([A-Z][A-Za-z0-9_]*)\s*>/g;

  const selfNames = new Set<string>();
  // Mark self-closing positions to subtract from the opener count.
  let m: RegExpExecArray | null;
  const selfCounts = new Map<string, number>();
  while ((m = selfClose.exec(src))) {
    selfCounts.set(m[1], (selfCounts.get(m[1]) ?? 0) + 1);
    selfNames.add(m[1]);
  }
  while ((m = opening.exec(src))) {
    open.set(m[1], (open.get(m[1]) ?? 0) + 1);
  }
  while ((m = closing.exec(src))) {
    close.set(m[1], (close.get(m[1]) ?? 0) + 1);
  }
  // Subtract self-closes from open (since regex `opening` also matches `<Foo />`).
  for (const [name, c] of selfCounts) {
    open.set(name, (open.get(name) ?? 0) - c);
  }
  return { open, close };
}

function looksTruncated(src: string): boolean {
  const trimmed = src.trimEnd();
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1];
  // Healthy file endings: closing brace, paren, bracket, semicolon.
  if ([")", "}", "]", ";"].includes(last)) return false;
  // A trailing `>` is only healthy when it closes a tag — `/>` (self-close)
  // or `</…>` (closing tag). A bare opening `<Card …>` ends in `>` too, and
  // those are exactly the truncation cases we need to catch (real-world
  // failure: file ended at `<Card className="...">\n` with no closer).
  if (last === ">") {
    // Look at the tail after stripping trailing whitespace.
    if (trimmed.endsWith("/>")) return false;
    // Find the last `<` and check if this is a closing tag `</foo>`.
    const lastOpen = trimmed.lastIndexOf("<");
    if (lastOpen >= 0 && trimmed[lastOpen + 1] === "/") return false;
    // Otherwise: opening tag with no closer in sight → truncated.
    return true;
  }
  // Allow trailing comma (rare but valid in some configs) — but flag everything else.
  return true;
}

function braceBalance(src: string): { braces: number; parens: number; brackets: number } {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const c of src) {
    if (c === "{") braces++;
    else if (c === "}") braces--;
    else if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (c === "[") brackets++;
    else if (c === "]") brackets--;
  }
  return { braces, parens, brackets };
}

/**
 * Detect string literals that opened but never closed before EOF or before
 * a hard newline (for ' and "). Template literals (`) may legally span lines
 * but must still close. This is the #1 build-failure mode in our telemetry
 * (`Unterminated string literal`, `Unterminated regular expression`).
 *
 * Returns a short snippet to put in the issue detail.
 */
function findUnterminatedString(src: string): string | null {
  let i = 0;
  const n = src.length;
  let line = 1;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    // Skip line comments.
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // Skip block comments — and detect unterminated ones too.
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      if (i >= n) return `unterminated /* … */ block comment starting near line ${line}`;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          // Skip escapes (including \" \' \\ \n etc.). A literal newline
          // inside a single/double-quoted string is illegal — flag it.
          if (src[i + 1] === "\n") return `unterminated string starting at line ${startLine}`;
          i += 2;
          continue;
        }
        if (src[i] === "\n") {
          // Hard newline inside ' or " — esbuild treats this as
          // "Unterminated string literal" (matches our telemetry exactly).
          return `unterminated string starting at line ${startLine}`;
        }
        i++;
      }
      if (i >= n) return `unterminated string starting at line ${startLine}`;
      i++;
      continue;
    }
    if (c === "`") {
      const startLine = line;
      i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            else if (src[i] === "\n") line++;
            i++;
          }
          continue;
        }
        if (src[i] === "\n") line++;
        i++;
      }
      if (i >= n) return `unterminated template literal starting at line ${startLine}`;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/**
 * Find PascalCase JSX tag names that have no corresponding import or local
 * declaration in the file. Catches the common failure mode where the model
 * writes `<Container>` / `<Inline>` / `<Button>` etc. without an import,
 * which compiles fine (TS treats them as `any`) but throws ReferenceError
 * at runtime in the deployed bundle.
 *
 * Heuristic, not a full resolver — we only flag names that don't appear
 * anywhere outside JSX as a defensible declaration site.
 */
function findUndefinedComponents(src: string, clean: string): string[] {
  const tagRe = /<([A-Z][A-Za-z0-9_]*)\b/g;
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(clean))) tags.add(m[1]);
  if (tags.size === 0) return [];

  // Collect "declared" names from imports + local declarations.
  const declared = new Set<string>();

  // Imports: import X, {A, B as C}, * as NS from "..."
  const importRe = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:,\s*\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g;
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
  // Plain `import "..."` and `import * as NS from "..."` (already handled above).

  // Local declarations: const Foo = ..., function Foo(...), class Foo
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g;
  while ((m = declRe.exec(src))) declared.add(m[1]);

  // React intrinsics + namespace shortcuts that don't need imports.
  const builtins = new Set(["Fragment", "StrictMode", "Suspense", "Profiler", "Children"]);

  const missing: string[] = [];
  for (const tag of tags) {
    if (declared.has(tag)) continue;
    if (builtins.has(tag)) continue;
    // Namespaced tags like <Foo.Bar> never trigger here (we matched only the head).
    // If a name is used as `Tag.X` (e.g. <RadioGroup.Item>), the JSX regex
    // captures only `RadioGroup`, which still must be imported, so this is fine.
    missing.push(tag);
  }
  return missing;
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function resolveImportPath(fromPath: string, spec: string, byPath: Map<string, string>): string | null {
  const base = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : spec.startsWith(".")
      ? normalizePath(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`)
      : null;
  if (!base) return null;
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`];
  return candidates.find((p) => byPath.has(p)) ?? null;
}

function findLazyNamedExportIssues(files: { path: string; content: string }[], changedPaths: Set<string>): LocalIssue[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const issues: LocalIssue[] = [];
  const lazyRe = /const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*\)/g;

  for (const f of files) {
    if (!changedPaths.has(f.path) || !/\.(tsx?|jsx?)$/.test(f.path) || !f.content.includes("lazy(")) continue;
    let m: RegExpExecArray | null;
    while ((m = lazyRe.exec(f.content))) {
      const componentName = m[1];
      const targetPath = resolveImportPath(f.path, m[2], byPath);
      if (!targetPath) continue;
      const target = byPath.get(targetPath) ?? "";
      if (/\bexport\s+default\b/.test(target)) continue;
      const named = new RegExp(`\\bexport\\s+(?:function|const|let|class)\\s+${componentName}\\b`).test(target) ||
        new RegExp(`\\bexport\\s*\\{[^}]*\\b${componentName}\\b[^}]*\\}`).test(target);
      if (!named) continue;
      issues.push({
        path: targetPath,
        kind: "lazy-export",
        detail: `${f.path} lazy-loads ${componentName}, but ${targetPath} has no default export`,
      });
    }
  }
  return issues;
}

export function verifyFileLocal(path: string, content: string): LocalIssue[] {
  if (!SCANNABLE.test(path)) return [];
  const issues: LocalIssue[] = [];

  if (/keep existing code/i.test(content)) {
    issues.push({
      path,
      kind: "truncation",
      detail: "unexpanded keep-existing placeholder remains in generated file",
    });
  }

  // Unterminated string / template / regex / block-comment detection.
  // This is the #1 build-failure mode in our telemetry — esbuild reports it
  // as "Unterminated string literal" / "Unterminated regular expression" /
  // "Unexpected end of file". Catch it deterministically here so the
  // continuation pass kicks in before the user ever sees a build failure.
  const unterm = findUnterminatedString(content);
  if (unterm) {
    issues.push({
      path,
      kind: "unterminated-string",
      detail: unterm,
    });
  }

  if (looksTruncated(content)) {
    const tail = content.trimEnd().slice(-40).replace(/\s+/g, " ");
    issues.push({
      path,
      kind: "truncation",
      detail: `file ends mid-statement: "…${tail}"`,
    });
  }

  const clean = stripNoise(content);

  const { braces, parens, brackets } = braceBalance(clean);
  if (braces !== 0 || parens !== 0 || brackets !== 0) {
    issues.push({
      path,
      kind: "braces",
      detail: `unbalanced: braces=${braces} parens=${parens} brackets=${brackets}`,
    });
  }

  const { open, close } = jsxTagBalance(clean);
  const allTags = new Set([...open.keys(), ...close.keys()]);
  for (const tag of allTags) {
    const o = open.get(tag) ?? 0;
    const c = close.get(tag) ?? 0;
    if (o !== c) {
      issues.push({
        path,
        kind: "jsx",
        detail: `<${tag}>: ${o} open vs ${c} close`,
      });
      // One JSX issue is enough signal — don't spam.
      break;
    }
  }

  const missing = findUndefinedComponents(content, clean);
  if (missing.length > 0) {
    issues.push({
      path,
      kind: "undefined",
      detail: `undefined component(s): ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}`,
    });
  }

  return issues;
}

/**
 * Walk every emitted .ts/.tsx file and collect its bare imports. For each
 * one, decide whether it can possibly resolve at build time:
 *   - relative `./Foo` or alias `@/Foo`  →  must exist in the file map
 *     (changed OR scaffold OR pre-existing).
 *   - bare `pkg` or `@scope/pkg`         →  must be in package.json deps.
 * Anything that fails resolves to a `missing-sibling` or `missing-dep` issue.
 *
 * Whitelisted: `react`, `react-dom`, scaffold-managed namespaces (`@/components/ui/*`,
 * `@/integrations/backend/*`, `@/lib/utils`) — those always exist in the kit.
 */
function findUnresolvedImports(
  files: { path: string; content: string }[],
  changedPaths: Set<string>,
): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  // Build the dep whitelist from the AI-emitted package.json (or the
  // scaffold's, if the AI didn't emit one).
  const deps = new Set<string>([
    "react",
    "react-dom",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);
  const pkgRaw = byPath.get("package.json");
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
      for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);
    } catch {
      /* malformed package.json — handled elsewhere */
    }
  }

  // Scaffold prefixes that always resolve via the kit even when no file map
  // entry exists yet (the kit injects them post-AI).
  const SCAFFOLD_PREFIXES = [
    "@/components/ui/",
    "@/integrations/backend/",
    "@/integrations/lovable/",
    "@/lib/utils",
    "@/lib/router",
    "@/styles.css",
  ];
  function isScaffoldAlias(spec: string): boolean {
    return SCAFFOLD_PREFIXES.some((p) => spec === p || spec.startsWith(p));
  }

  // Bare specifier → npm package name (handles scoped: `@scope/pkg` and
  // sub-paths: `pkg/sub/path` → `pkg`, `@scope/pkg/sub` → `@scope/pkg`).
  function pkgRoot(spec: string): string {
    if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
    return spec.split("/")[0];
  }

  // Single regex catches both `import … from "x"` and bare side-effect
  // imports `import "x"`. Skip type-only imports — they don't trigger Rollup.
  const importRe = /import\s+(?!type\b)(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g;
  // Also catch dynamic imports + CJS-style requires the model occasionally
  // emits inside server functions.
  const dynRe = /(?:^|[^.\w])import\(\s*["']([^"']+)["']\s*\)/g;

  const seen = new Set<string>();
  for (const f of files) {
    if (!changedPaths.has(f.path)) continue;
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;

    const specs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(f.content))) specs.push(m[1]);
    while ((m = dynRe.exec(f.content))) specs.push(m[1]);

    for (const spec of specs) {
      // Already-emitted issue for this file/spec? Skip noise.
      const dedupeKey = `${f.path}|${spec}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Relative or alias import → resolve against the file map.
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        if (isScaffoldAlias(spec)) continue;
        const resolved = resolveImportPath(f.path, spec, byPath);
        if (!resolved) {
          issues.push({
            path: f.path,
            kind: "missing-sibling",
            detail: `import "${spec}" — referenced file does not exist`,
          });
        }
        continue;
      }

      // Bare specifier → npm package.
      const root = pkgRoot(spec);
      if (!deps.has(root)) {
        issues.push({
          path: f.path,
          kind: "missing-dep",
          detail: `import "${spec}" — package "${root}" is not in package.json`,
        });
      }
    }
  }
  return issues;
}

/**
 * Collect named exports declared in a single file. Heuristic — covers the
 * common shapes the model emits:
 *   export const Foo = …  /  export function Foo  /  export class Foo
 *   export { Foo, Bar as Baz }
 *   export { Foo } from "./other"        (re-export)
 *   export * from "./other"              (star re-export → marked separately)
 *   export default …                     (tracked as "default")
 *   export type Foo / export interface Foo / export enum Foo
 */
interface FileExports {
  named: Set<string>;
  hasDefault: boolean;
  starReexports: string[]; // unresolved specifiers — treat as "exports anything"
}

function collectExports(src: string): FileExports {
  const named = new Set<string>();
  let hasDefault = false;
  const starReexports: string[] = [];

  // export default …
  if (/(^|\n)\s*export\s+default\b/.test(src)) hasDefault = true;

  // export {const|let|var|function|class|type|interface|enum} Name
  const declRe = /(^|\n)\s*export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) named.add(m[2]);

  // export { A, B as C } [from "..."]
  const groupRe = /export\s*\{([^}]+)\}/g;
  while ((m = groupRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const name = piece.split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) named.add(name);
    }
  }

  // export * from "spec"
  const starRe = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  while ((m = starRe.exec(src))) starReexports.push(m[1]);

  return { named, hasDefault, starReexports };
}

/**
 * For each changed file, scan its named imports from relative/alias paths
 * and confirm the target file actually exports those names. Catches the
 * "model invents an export" failure mode where `import { useFooStore }`
 * compiles in dev (TS treats missing as undefined) but throws at runtime
 * or fails the production build.
 *
 * Conservative: skips files we can't resolve, default imports, type-only
 * imports, namespace imports, and any target that uses `export * from`
 * (since we can't easily follow the chain without a full resolver).
 */
function findMissingNamedExports(
  files: { path: string; content: string }[],
  changedPaths: Set<string>,
): LocalIssue[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const exportCache = new Map<string, FileExports>();
  const exportsOf = (path: string): FileExports => {
    let e = exportCache.get(path);
    if (!e) {
      e = collectExports(byPath.get(path) ?? "");
      exportCache.set(path, e);
    }
    return e;
  };

  const issues: LocalIssue[] = [];
  // Match `import [type] { A, B as C } from "spec"` — captures the brace
  // contents and the specifier. Skips type-only imports and default/namespace-only.
  const importRe = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;

  const seen = new Set<string>();
  for (const f of files) {
    if (!changedPaths.has(f.path)) continue;
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;

    let m: RegExpExecArray | null;
    while ((m = importRe.exec(f.content))) {
      const group = m[1];
      const spec = m[2];
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;

      const targetPath = resolveImportPath(f.path, spec, byPath);
      if (!targetPath) continue; // missing-sibling handles this elsewhere

      const exp = exportsOf(targetPath);
      // If the target re-exports * from somewhere, we can't safely judge
      // missing names — treat as "exports anything" to avoid false positives.
      if (exp.starReexports.length > 0) continue;

      // Parse imported names: "A, B as C, type D" → ["A","C"] (skip type-only).
      for (const part of group.split(",")) {
        const piece = part.trim();
        if (!piece) continue;
        // Skip per-specifier `type X` imports.
        const isTypeOnly = /^type\s+/i.test(piece);
        if (isTypeOnly) continue;
        const segs = piece.split(/\s+as\s+/i);
        const original = segs[0].replace(/^type\s+/i, "").trim();
        if (!original || !/^[A-Za-z_$][\w$]*$/.test(original)) continue;
        // `default as X` is valid and renames the default export.
        if (original === "default") {
          if (!exp.hasDefault) {
            const key = `${f.path}|${spec}|default`;
            if (seen.has(key)) continue;
            seen.add(key);
            issues.push({
              path: f.path,
              kind: "missing-export",
              detail: `import { default } from "${spec}" — ${targetPath} has no default export`,
            });
          }
          continue;
        }
        if (exp.named.has(original)) continue;
        const key = `${f.path}|${spec}|${original}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
          path: f.path,
          kind: "missing-export",
          detail: `import { ${original} } from "${spec}" — ${targetPath} does not export "${original}"`,
        });
      }
    }
  }
  return issues;
}

export function verifyFilesLocal(
  files: { path: string; content: string }[],
  changedPaths: string[],
): LocalVerdict {
  const changed = new Set(changedPaths);
  const issues: LocalIssue[] = [];
  for (const f of files) {
    if (!changed.has(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;
    // Reference snippets shipped by the scaffold (examples-pack). They are
    // intentionally partial — generic identifiers like <Row>/<T>/<Step>, no
    // closing tags on purpose — so the AI can read them as patterns. They
    // are never imported by the app and never compiled. Verifying them
    // produces dozens of phantom "truncation"/"jsx" issues every turn,
    // which then triggers a continuation pass that corrupts real files.
    if (f.path.startsWith("src/components/examples/")) continue;
    issues.push(...verifyFileLocal(f.path, f.content));
  }
  issues.push(...findLazyNamedExportIssues(files, changed));
  issues.push(...findUnresolvedImports(files, changed));
  issues.push(...findMissingNamedExports(files, changed));
  return { ok: issues.length === 0, issues };
}
