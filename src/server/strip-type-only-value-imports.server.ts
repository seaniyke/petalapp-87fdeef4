/**
 * Build-time codemod: detect named imports where the imported name is ONLY
 * declared as a TypeScript type/interface in the target file (no runtime
 * value), and HEAL the target file by appending a passthrough value export
 * under the same name.
 *
 * Why this exists:
 *   `import { NavLink } from "@/components/blocks/nav-with-cta"` where
 *   nav-with-cta.tsx only declares `export interface NavLink { … }` passes
 *   `tsc --noEmit` (TS allows it) but Rollup's prod build fails:
 *     `"NavLink" is not exported by "src/components/blocks/nav-with-cta.tsx"`.
 *   And if we instead strip the import, any remaining `<NavLink … />` JSX
 *   crashes at runtime with `Can't find variable: NavLink`. So we inject a
 *   runtime stub `export const NavLink: any = (props) => props.children ?? null`.
 *   The interface keeps living in type-space; the const lives in value-space
 *   (TS allows the same name in both). Build + runtime both resolve, and the
 *   preview renders something instead of going blank.
 *
 *   Conservative: skips packages, `export * from`, the ui kit, and
 *   integrations. Idempotent: a stub is only injected once per name.
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
  const outByPath = new Map(out.map((f) => [f.path, f]));

  // Track stubs to inject per target file: targetPath -> set of names.
  const stubs = new Map<string, Set<string>>();

  // Match named-value imports (skip `import type …`).
  const importRe = /import\s+(?!type\b)([^"';]+?)\s+from\s+["']([^"']+)["'];?/g;

  for (const f of out) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;

    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(f.content))) {
      const clause = m[1];
      const spec = m[2];
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const target = resolveImportPath(f.path, spec, byPath);
      if (!target) continue;
      const exp = exportsOf(target);
      if (exp.hasStar) continue;

      const braceStart = clause.indexOf("{");
      if (braceStart < 0) continue;
      const braceEnd = clause.indexOf("}", braceStart);
      if (braceEnd < 0) continue;
      const inside = clause.slice(braceStart + 1, braceEnd);

      const needStub: string[] = [];
      for (const raw of inside.split(",")) {
        const piece = raw.trim();
        if (!piece) continue;
        if (/^type\s+/i.test(piece)) continue;
        const original = piece.split(/\s+as\s+/i)[0].trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(original)) continue;
        if (exp.value.has(original)) continue;
        if (exp.typeOnly.has(original)) needStub.push(original);
      }
      if (needStub.length === 0) continue;

      let set = stubs.get(target);
      if (!set) {
        set = new Set();
        stubs.set(target, set);
      }
      for (const n of needStub) set.add(n);
      stripped.push({ file: f.path, spec, names: needStub });
    }
  }

  // Inject stubs into target files and promote the name from typeOnly→value
  // so subsequent passes (and future calls) see it as a value export.
  for (const [target, names] of stubs) {
    const file = outByPath.get(target);
    if (!file) continue;
    const exp = exportsOf(target);
    const lines: string[] = [];
    for (const n of names) {
      if (exp.value.has(n)) continue;
      lines.push(
        `// Auto-injected runtime stub: \`${n}\` was declared only as a type/interface ` +
        `but imported as a value. Renders children as a passthrough so the preview does not crash.`,
      );
      lines.push(
        `export const ${n}: any = (props: any) => (props && props.children) ? props.children : null;`,
      );
      exp.value.add(n);
      exp.typeOnly.delete(n);
    }
    if (lines.length === 0) continue;
    const sep = file.content.endsWith("\n") ? "\n" : "\n\n";
    file.content = `${file.content}${sep}${lines.join("\n")}\n`;
  }

  return { files: out, stripped };
}
