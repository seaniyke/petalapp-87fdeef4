/**
 * Scope repair — Quality Push A4.
 *
 * The second-biggest local-verify failure after `missing-sibling` is `scope`:
 * a file references an identifier nothing in that file declares. In practice
 * almost every one of those is a *forgotten import* of a symbol whose home is
 * unambiguous — `useState` (react), `Sparkles` (lucide-react), `cn`
 * (@/lib/utils), `Link` (the router the project already uses), `toast`
 * (sonner), `motion` (framer-motion).
 *
 * Asking a model to add an import it already knows about costs a repair round
 * and the user's credits, so we do the unambiguous ones deterministically and
 * leave everything else to the verifier to report honestly.
 *
 * Pure: ProjectFile[] → ProjectFile[].
 */

import type { ProjectFile } from "./generate.server";
import { COMMON_LUCIDE_ICONS } from "./known-packages";

export interface ScopeRepairResult {
  files: ProjectFile[];
  notes: string[];
  /** Number of identifiers given a home. */
  fixes: number;
}

const SCANNABLE = /\.(tsx?|jsx?)$/;

/** Hooks/values whose only sane home is `react`. */
const REACT_SYMBOLS = new Set([
  "useState",
  "useEffect",
  "useMemo",
  "useRef",
  "useCallback",
  "useReducer",
  "useContext",
  "useLayoutEffect",
  "useId",
  "useTransition",
  "useDeferredValue",
  "createContext",
  "forwardRef",
  "memo",
  "Fragment",
  "Children",
  "cloneElement",
  "isValidElement",
  "Suspense",
  "lazy",
]);

/** Router symbols — only injected when the project already uses a router. */
const ROUTER_SYMBOLS = new Set([
  "Link",
  "NavLink",
  "Outlet",
  "Navigate",
  "useNavigate",
  "useLocation",
  "useParams",
  "useSearchParams",
]);

const FRAMER_SYMBOLS = new Set(["motion", "AnimatePresence"]);

/** Identifier → module, for the fixed-home symbols. */
function homeFor(
  name: string,
  ctx: { routerModule: string | null; hasFramer: boolean; hasSonner: boolean },
): string | null {
  if (REACT_SYMBOLS.has(name)) return "react";
  if (name === "cn") return "@/lib/utils";
  if (name === "toast" && ctx.hasSonner) return "sonner";
  if (FRAMER_SYMBOLS.has(name) && ctx.hasFramer) return "framer-motion";
  if (ROUTER_SYMBOLS.has(name) && ctx.routerModule) return ctx.routerModule;
  if (COMMON_LUCIDE_ICONS.has(name)) return "lucide-react";
  return null;
}

/** Blank out comments and string/template literals so usage scanning is clean. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, ' "" ')
    .replace(/'(?:\\.|[^'\\])*'/g, " '' ");
}

function collectDeclared(src: string): Set<string> {
  const declared = new Set<string>();
  let m: RegExpExecArray | null;

  const declRe = /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src))) declared.add(m[1]);

  // Destructured bindings: `const { a, b: c } = …`, `const [a, b] = …`.
  const destructureRe = /\b(?:const|let|var)\s*([[{])([^)]{0,400}?)[\]}]\s*=/g;
  while ((m = destructureRe.exec(src))) {
    for (const piece of m[2].split(",")) {
      const name = piece.includes(":") ? piece.split(":").pop() : piece;
      const clean = name?.replace(/[^\w$]/g, "").trim();
      if (clean) declared.add(clean);
    }
  }

  // Imports (default, named, namespace).
  const importRe =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:,\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g;
  while ((m = importRe.exec(src))) {
    if (m[1]) declared.add(m[1]);
    if (m[3]) declared.add(m[3]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const piece = part.trim().replace(/^type\s+/i, "");
        const name = piece.split(/\s+as\s+/i).pop()?.trim();
        if (name) declared.add(name);
      }
    }
  }

  // Function/arrow parameters — coarse but safe (over-declaring only means we
  // skip an injection, never that we inject a wrong one).
  const paramRe = /\(([^)]{0,400})\)\s*(?::[^=\n]{0,120})?=>|function\s*[A-Za-z_$]*\s*\(([^)]{0,400})\)/g;
  while ((m = paramRe.exec(src))) {
    const params = (m[1] || m[2] || "").replace(/:[^,=}]+/g, "");
    for (const name of params.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) declared.add(name[0]);
  }

  return declared;
}

/** Identifiers actually referenced as values (JSX tags or bare expressions). */
function collectUsed(src: string): Set<string> {
  const clean = stripNoise(src);
  const used = new Set<string>();

  // JSX tags: `<Foo`, `</Foo`, `<Foo.Bar`.
  for (const m of clean.matchAll(/<\/?\s*([A-Z][\w$]*)/g)) used.add(m[1]);

  // Bare value references, skipping property access (`x.Foo`) and object keys.
  for (const m of clean.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?=[(<),;\].}=&|?:\s])/g)) {
    used.add(m[2]);
  }
  return used;
}

function detectRouterModule(files: ProjectFile[]): string | null {
  const all = files.map((f) => f.content).join("\n");
  if (/from\s+["']react-router-dom["']/.test(all)) return "react-router-dom";
  if (/from\s+["']@tanstack\/react-router["']/.test(all)) return "@tanstack/react-router";
  return null;
}

function depsOf(files: ProjectFile[]): Set<string> {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return new Set();
  try {
    const parsed = JSON.parse(pkg.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

/** Merge `names` into an existing named import from `mod`, or add a new line. */
function addImports(src: string, mod: string, names: string[]): string {
  const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`import\\s+([^;\\n]*?)\\s+from\\s+["']${escaped}["'];?`);
  const m = existing.exec(src);

  if (m) {
    const clause = m[1];
    const braceIdx = clause.indexOf("{");
    let next: string;
    if (braceIdx >= 0) {
      const close = clause.lastIndexOf("}");
      const inner = clause.slice(braceIdx + 1, close).trim();
      const merged = inner ? `${inner.replace(/,\s*$/, "")}, ${names.join(", ")}` : names.join(", ");
      next = `${clause.slice(0, braceIdx)}{ ${merged} }${clause.slice(close + 1)}`;
    } else {
      next = `${clause.trim()}, { ${names.join(", ")} }`;
    }
    return src.replace(m[0], `import ${next} from "${mod}";`);
  }

  const line = `import { ${names.join(", ")} } from "${mod}";`;
  const lines = src.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) lastImport = i;
  }
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, line);
    return lines.join("\n");
  }
  // Keep "use client"/directives on top.
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*(["'].*["'];?|\/\/.*)?\s*$/.test(lines[insertAt]) && lines[insertAt].trim()) {
    insertAt++;
  }
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

/**
 * `import type { Square } from "lucide-react"` compiles cleanly but erases the
 * binding at runtime, so the rendered page dies with
 * `ReferenceError: Square is not defined`. Move names that are plainly values
 * — a lucide icon, or anything used as `<Name …/>` — into a value import.
 */
export function promoteTypeOnlyValueImports(src: string): string {
  const typeImportRe = /import\s+type\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g;
  return src.replace(typeImportRe, (stmt, inside: string, mod: string) => {
    const keep: string[] = [];
    const promote: string[] = [];
    for (const raw of inside.split(",")) {
      const piece = raw.trim();
      if (!piece) continue;
      const local = (piece.split(/\s+as\s+/i).pop() ?? piece).trim();
      const original = piece.split(/\s+as\s+/i)[0]!.trim();
      const usedAsElement = new RegExp(`<${local}\\b`).test(src);
      const isIcon = mod === "lucide-react" && COMMON_LUCIDE_ICONS.has(original);
      if (usedAsElement || isIcon) promote.push(piece);
      else keep.push(piece);
    }
    if (promote.length === 0) return stmt;
    const valueLine = `import { ${promote.join(", ")} } from "${mod}";`;
    if (keep.length === 0) return valueLine;
    return `import type { ${keep.join(", ")} } from "${mod}";\n${valueLine}`;
  });
}

export function repairScopeLeaks(input: ProjectFile[]): ScopeRepairResult {
  const routerModule = detectRouterModule(input);
  const deps = depsOf(input);
  const ctx = {
    routerModule,
    hasFramer: deps.has("framer-motion") || input.some((f) => /from\s+["']framer-motion["']/.test(f.content)),
    hasSonner: deps.has("sonner") || input.some((f) => /from\s+["']sonner["']/.test(f.content)),
  };

  const notes: string[] = [];
  let fixes = 0;

  const files = input.map((file) => {
    if (!SCANNABLE.test(file.path)) return file;
    let src = file.content;
    if (!src || src.length > 400_000) return file;

    const promoted = promoteTypeOnlyValueImports(src);
    if (promoted !== src) {
      src = promoted;
      fixes += 1;
      notes.push(`scope-repair: promoted type-only value import(s) in ${file.path}`);
    }

    const declared = collectDeclared(src);
    const used = collectUsed(src);


    const byModule = new Map<string, string[]>();
    for (const name of used) {
      if (declared.has(name)) continue;
      const mod = homeFor(name, ctx);
      if (!mod) continue;
      // Don't inject an import a file already has under a different shape.
      const list = byModule.get(mod) ?? [];
      if (!list.includes(name)) list.push(name);
      byModule.set(mod, list);
    }
    if (byModule.size === 0) return src === file.content ? file : { ...file, content: src };

    let next = src;
    const added: string[] = [];
    for (const [mod, names] of byModule) {
      names.sort();
      next = addImports(next, mod, names);
      added.push(...names);
      fixes += names.length;
    }
    notes.push(`scope-repair: imported ${added.join(", ")} in ${file.path}`);
    return { ...file, content: next };
  });

  return { files, notes, fixes };
}
