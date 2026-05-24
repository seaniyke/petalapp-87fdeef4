/**
 * Build-time codemod: detect named imports where the imported name is ONLY
 * declared as a TypeScript type/interface in the target file (no runtime
 * value), and strip those names from the import clause.
 *
 * Why this exists:
 *   `import { NavLink } from "@/components/blocks/nav-with-cta"` where
 *   nav-with-cta.tsx only declares `export interface NavLink { … }` passes
 *   `tsc --noEmit` (TS allows it) but Rollup's production build fails hard:
 *     `"NavLink" is not exported by "src/components/blocks/nav-with-cta.tsx"`
 *   because the interface is erased before bundling. The model frequently
 *   conflates a block's exported INTERFACE name with a component name and
 *   imports it as a value, blanking the deployed preview.
 *
 * Strategy:
 *   - Build an index of value vs. type-only exports for every project file.
 *   - For each named import from a local / aliased path, drop any specifier
 *     whose original name is type-only in the target.
 *   - If the entire braces clause becomes empty AND there's no default/
 *     namespace import alongside it, remove the whole import statement.
 *   - Idempotent and conservative: skips packages, `export * from`, and
 *     anything we can't resolve.
 */
import type { ProjectFile } from "./generate.server";

interface FileExports {
  value: Set<string>;
  typeOnly: Set<string>;
  hasStar: boolean;
}

function collectExports(src: string): FileExports {
  const value = new Set<string>();
  const typeOnly = new Set<string>();
  let hasStar = false;

  let m: RegExpExecArray | null;

  // Value declarations
  const valueDeclRe = /(^|\n)\s*export\s+(?:async\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = valueDeclRe.exec(src))) value.add(m[2]);

  // Type-only declarations
  const typeDeclRe = /(^|\n)\s*export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = typeDeclRe.exec(src))) typeOnly.add(m[2]);

  // `export { A, B as C }` — treat as value (we can't tell from re-export site)
  const groupRe = /(^|[^A-Za-z_$])export\s*\{([^}]+)\}/g;
  while ((m = groupRe.exec(src))) {
    for (const part of m[2].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const name = piece.split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) value.add(name);
    }
  }

  // `export type { … }`
  const typeGroupRe = /export\s+type\s*\{([^}]+)\}/g;
  while ((m = typeGroupRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const name = piece.split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
        typeOnly.add(name);
        value.delete(name);
      }
    }
  }

  // `export * from "…"` — unknown surface; mark to avoid false positives
  if (/export\s*\*\s*from\s*["']/.test(src)) hasStar = true;

  return { value, typeOnly, hasStar };
}

function resolveImportPath(
  fromPath: string,
  spec: string,
  files: Map<string, string>,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = "src/" + spec.slice(2);
  } else if (spec.startsWith(".")) {
    const segs = fromPath.split("/");
    segs.pop();
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") segs.pop();
      else segs.push(part);
    }
    base = segs.join("/");
  } else {
    return null;
  }
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ];
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

export function stripTypeOnlyValueImports(files: ProjectFile[]): {
  files: ProjectFile[];
  stripped: { file: string; spec: string; names: string[] }[];
} {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const exportCache = new Map<string, FileExports>();
  const exportsOf = (p: string): FileExports => {
    let e = exportCache.get(p);
    if (!e) {
      e = collectExports(byPath.get(p) ?? "");
      exportCache.set(p, e);
    }
    return e;
  };

  const stripped: { file: string; spec: string; names: string[] }[] = [];
  const out: ProjectFile[] = files.map((f) => ({ ...f }));

  // Match a full import statement; capture default/namespace prefix, braces clause, spec.
  // `import [type] [Default[, ]] [* as Ns] [{ … }] from "spec";`
  // Keep it permissive — we only mutate the braces clause.
  const importRe = /import\s+(?!type\b)([^"';]+?)\s+from\s+["']([^"']+)["'];?/g;

  for (const f of out) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;

    let changed = false;
    const newContent = f.content.replace(importRe, (whole, clause: string, spec: string) => {
      if (!spec.startsWith(".") && !spec.startsWith("@/")) return whole;
      const target = resolveImportPath(f.path, spec, byPath);
      if (!target) return whole;
      const exp = exportsOf(target);
      if (exp.hasStar) return whole;

      const braceStart = clause.indexOf("{");
      if (braceStart < 0) return whole;
      const braceEnd = clause.indexOf("}", braceStart);
      if (braceEnd < 0) return whole;

      const prefix = clause.slice(0, braceStart).replace(/,\s*$/, "").trim();
      const inside = clause.slice(braceStart + 1, braceEnd);
      const suffix = clause.slice(braceEnd + 1).trim();

      const keptSpecs: string[] = [];
      const droppedNames: string[] = [];
      for (const raw of inside.split(",")) {
        const piece = raw.trim();
        if (!piece) continue;
        // Per-specifier `type X` is already type-only — preserve as-is.
        if (/^type\s+/i.test(piece)) {
          keptSpecs.push(piece);
          continue;
        }
        const original = piece.split(/\s+as\s+/i)[0].trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(original)) {
          keptSpecs.push(piece);
          continue;
        }
        if (exp.value.has(original)) {
          keptSpecs.push(piece);
          continue;
        }
        if (exp.typeOnly.has(original)) {
          droppedNames.push(original);
          continue; // drop — would crash Rollup
        }
        // Unknown name: leave it. Other guards (missing-export) handle it.
        keptSpecs.push(piece);
      }

      if (droppedNames.length === 0) return whole;
      changed = true;
      stripped.push({ file: f.path, spec, names: droppedNames });

      const hasOtherBinding = prefix.length > 0 || suffix.length > 0;
      if (keptSpecs.length === 0) {
        if (!hasOtherBinding) {
          // Remove the entire import statement.
          return "";
        }
        // Rebuild clause without the braces.
        const rebuilt = [prefix, suffix].filter(Boolean).join(" ").trim();
        return `import ${rebuilt} from "${spec}";`;
      }
      const braces = `{ ${keptSpecs.join(", ")} }`;
      const parts = [prefix, braces, suffix].filter(Boolean).join(", ");
      return `import ${parts.replace(/,\s*\{/, " { ").replace(/^,\s*/, "")} from "${spec}";`;
    });

    if (changed) f.content = newContent;
  }

  return { files: out, stripped };
}
