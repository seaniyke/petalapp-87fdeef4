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
  kind: "truncation" | "jsx" | "braces" | "undefined";
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

export function verifyFileLocal(path: string, content: string): LocalIssue[] {
  if (!SCANNABLE.test(path)) return [];
  const issues: LocalIssue[] = [];

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
    issues.push(...verifyFileLocal(f.path, f.content));
  }
  return { ok: issues.length === 0, issues };
}
