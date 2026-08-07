/**
 * Sibling resolution — Quality Push A3.
 *
 * `missing-sibling` is the single biggest local-verify failure. Almost none of
 * them are "the model forgot to write the file": the file IS in the pass, the
 * import just points at a name the model half-remembered — `./Hero` for
 * `./hero.tsx`, `@/components/BookingForm` for
 * `@/components/booking/BookingForm.tsx`, `./Card.jsx` for `./Card.tsx`,
 * `@/components/sections/Footer` when the file landed at
 * `@/components/Footer`.
 *
 * Every one of those is a deterministic lookup, so we do it here instead of
 * burning a repair round (and the user's credits) asking a model to rename an
 * import. Only unambiguous matches are rewritten — if two files could satisfy
 * the import we leave it alone and let the verifier report it honestly.
 *
 * Pure: ProjectFile[] → ProjectFile[].
 */

import type { ProjectFile } from "./generate.server";

export interface SiblingResolutionResult {
  files: ProjectFile[];
  notes: string[];
  /** Imports we could not resolve — still real defects for the verifier. */
  unresolved: Array<{ path: string; spec: string }>;
  fixes: number;
}

const SCANNABLE = /\.(tsx?|jsx?)$/;
const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

/** Namespaces the scaffold owns; these resolve at build time regardless. */
const SCAFFOLD_PREFIXES = [
  "@/components/ui/",
  "@/components/blocks/",
  "@/components/examples/",
  "@/integrations/",
  "@/lib/utils",
  "@/hooks/use-mobile",
];

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function toBase(fromPath: string, spec: string): string | null {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith(".")) return normalizePath(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`);
  return null;
}

function resolves(base: string, byPath: Map<string, string>): string | null {
  for (const ext of EXTS) if (byPath.has(base + ext)) return base + ext;
  return null;
}

/** "BookingForm" / "booking-form" / "bookingForm" all collapse to "bookingform". */
function fold(name: string): string {
  return name.replace(/[-_.\s]/g, "").toLowerCase();
}

function moduleName(path: string): string {
  const parts = path.replace(/\.(tsx?|jsx?)$/, "").split("/");
  const last = parts[parts.length - 1];
  // `foo/index.tsx` is named after its folder.
  return last === "index" && parts.length > 1 ? parts[parts.length - 2] : last;
}

/** Rewrite an absolute project path back into the alias form the file uses. */
function toSpec(targetPath: string, useAlias: boolean, fromPath: string): string {
  const bare = targetPath.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
  if (useAlias && bare.startsWith("src/")) return `@/${bare.slice(4)}`;
  const fromDir = fromPath.split("/").slice(0, -1).join("/");
  if (bare.startsWith(fromDir + "/")) return `./${bare.slice(fromDir.length + 1)}`;
  // Fall back to the alias form rather than emitting a fragile ../../ chain.
  return bare.startsWith("src/") ? `@/${bare.slice(4)}` : `./${bare}`;
}

/**
 * Find the one file in the pass that this import obviously meant. Returns
 * `null` when there is no candidate or more than one (never guess).
 */
function findIntendedTarget(
  spec: string,
  fromPath: string,
  byPath: Map<string, string>,
): string | null {
  const base = toBase(fromPath, spec);
  if (!base) return null;

  // 1. Wrong extension written explicitly (`./Card.jsx` when it's `.tsx`).
  const stripped = base.replace(/\.(tsx?|jsx?)$/, "");
  if (stripped !== base) {
    const hit = resolves(stripped, byPath);
    if (hit) return hit;
  }

  // 2. Case / separator drift on an otherwise correct path.
  const wantDir = stripped.split("/").slice(0, -1).join("/");
  const wantName = fold(stripped.split("/").pop() ?? "");
  if (!wantName) return null;

  const sameDir: string[] = [];
  const anywhere: string[] = [];
  for (const p of byPath.keys()) {
    if (!SCANNABLE.test(p) || !p.startsWith("src/")) continue;
    if (fold(moduleName(p)) !== wantName) continue;
    if (p.split("/").slice(0, -1).join("/") === wantDir) sameDir.push(p);
    anywhere.push(p);
  }
  if (sameDir.length === 1) return sameDir[0];
  if (sameDir.length > 1) return null;
  if (anywhere.length === 1) return anywhere[0];
  return null;
}

export function resolveSiblingImports(
  input: ProjectFile[],
  changedPaths?: Set<string>,
): SiblingResolutionResult {
  const byPath = new Map(input.map((f) => [f.path, f.content]));
  const notes: string[] = [];
  const unresolved: SiblingResolutionResult["unresolved"] = [];
  let fixes = 0;

  const files = input.map((f) => {
    if (!SCANNABLE.test(f.path)) return f;
    if (changedPaths && !changedPaths.has(f.path)) return f;
    if (f.path.startsWith("src/components/ui/") || f.path.startsWith("src/integrations/")) return f;

    let content = f.content;
    const specs = new Set<string>();
    const re = /(?:import\s+(?:type\s+)?(?:[^"';]+?\s+from\s+)?|import\(\s*|from\s+)["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content))) specs.add(m[1]);

    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      if (SCAFFOLD_PREFIXES.some((p) => spec === p || spec.startsWith(p))) continue;
      const base = toBase(f.path, spec);
      if (base && resolves(base, byPath)) continue;

      const target = findIntendedTarget(spec, f.path, byPath);
      if (!target) {
        unresolved.push({ path: f.path, spec });
        continue;
      }
      const next = toSpec(target, spec.startsWith("@/"), f.path);
      if (next === spec) {
        unresolved.push({ path: f.path, spec });
        continue;
      }
      // Replace only inside module specifier quotes, never in prose/JSX text.
      const before = content;
      content = content.replace(
        new RegExp(`(["'])${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g"),
        (_w, q: string) => `${q}${next}${q}`,
      );
      if (content !== before) {
        fixes++;
        notes.push(`sibling-resolver: ${f.path} — rewrote import "${spec}" → "${next}"`);
      }
    }
    return content === f.content ? f : { ...f, content };
  });

  return { files, notes, unresolved, fixes };
}
