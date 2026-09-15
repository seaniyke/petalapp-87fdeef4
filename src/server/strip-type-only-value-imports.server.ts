/**
 * Build-time codemod: detect named imports where the imported name does not
 * have a runtime export in the target file, and HEAL the target file by
 * appending a passthrough value export under the same name.
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
 *   Also covers alias-only exports such as `export { BrowserRouter as Router }`:
 *   importing `{ BrowserRouter }` from that module is still a missing runtime
 *   export unless the original name is exported too. Conservative: skips
 *   packages, `export * from`, importers inside the ui kit, and integrations.
 *   Idempotent: a stub is only injected once per name.
 */

import type { ProjectFile } from "./generate.server";

interface FileExports {
  value: Set<string>;
  typeOnly: Set<string>;
  hasStar: boolean;
}

type StubReason = "type-only" | "missing";

const STUB_BLOCK_RE =
  /\/\/ Auto-injected runtime stub:[\s\S]*?\n\s*export const [A-Za-z_$][\w$]*: any = \((?:props: any|\.\.\._args: any\[\])\)[^\n]*\n?/g;

function collectExports(rawSrc: string): FileExports {
  // A previously auto-injected passthrough stub is not a real export: ignore
  // it so a later pass can redirect the import to the module that really
  // implements the name instead of keeping the no-op stub forever.
  const src = rawSrc.replace(STUB_BLOCK_RE, "");
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

/** `src/integrations/backend/auth.tsx` → `@/integrations/backend/auth` */
function aliasSpecifier(path: string): string {
  const withoutExt = path.replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\/index$/, "");
  return withoutExt.startsWith("src/") ? "@/" + withoutExt.slice(4) : "./" + withoutExt;
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

  // Index of which modules actually export a given name as a runtime value.
  // Used to REDIRECT a wrong-module import (e.g. `useAuth` imported from
  // `@/integrations/backend/client` when it lives in `…/backend/auth`)
  // instead of stubbing it out, which silently breaks the feature at runtime.
  const valueExporters = new Map<string, string[]>();
  for (const f of files) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    for (const name of collectExports(f.content).value) {
      const list = valueExporters.get(name);
      if (list) list.push(f.path);
      else valueExporters.set(name, [f.path]);
    }
  }

  const findRedirect = (name: string, target: string, importer: string): string | null => {
    const all = (valueExporters.get(name) ?? []).filter((p) => p !== target && p !== importer);
    if (all.length === 0) return null;
    const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
    const sameDir = all.filter((p) => dirOf(p) === dirOf(target));
    const pick = sameDir.length === 1 ? sameDir[0] : all.length === 1 ? all[0] : null;
    return pick ? aliasSpecifier(pick) : null;
  };

  const stripped: { file: string; spec: string; names: string[] }[] = [];
  const out: ProjectFile[] = files.map((f) => ({ ...f }));
  const outByPath = new Map(out.map((f) => [f.path, f]));

  // Track stubs to inject per target file: targetPath -> name -> reason.
  const stubs = new Map<string, Map<string, StubReason>>();
  // Track import rewrites per importing file: statement -> replacement.
  const rewrites = new Map<string, Array<{ from: string; to: string }>>();

  // Match named-value imports (skip `import type …`).
  const importRe = /import\s+(?!type\b)([^"';]+?)\s+from\s+["']([^"']+)["'];?/g;

  for (const f of out) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;
    if (f.path.startsWith("src/integrations/")) continue;

    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(f.content))) {
      const statement = m[0];
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

      const needStub: Array<{ name: string; reason: StubReason }> = [];
      const redirected: Array<{ name: string; spec: string }> = [];
      for (const raw of inside.split(",")) {
        const piece = raw.trim();
        if (!piece) continue;
        if (/^type\s+/i.test(piece)) continue;
        const original = piece.split(/\s+as\s+/i)[0].trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(original)) continue;
        if (exp.value.has(original)) continue;
        const redirect = exp.typeOnly.has(original)
          ? null
          : findRedirect(original, target, f.path);
        if (redirect) {
          redirected.push({ name: piece, spec: redirect });
          continue;
        }
        needStub.push({
          name: original,
          reason: exp.typeOnly.has(original) ? "type-only" : "missing",
        });
      }

      if (redirected.length > 0) {
        // Drop the redirected names from the original clause and re-import
        // them from the module that really exports them.
        const kept = inside
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((piece) => !redirected.some((r) => r.name === piece));
        const before = clause.slice(0, braceStart).trim().replace(/,$/, "");
        const after = clause.slice(braceEnd + 1).trim();
        const parts: string[] = [];
        if (kept.length > 0 || (!before && !after)) {
          const head = before ? `${before}, ` : "";
          if (kept.length > 0) parts.push(`import ${head}{ ${kept.join(", ")} } from "${spec}";`);
          else if (before) parts.push(`import ${before} from "${spec}";`);
        } else if (before) {
          parts.push(`import ${before} from "${spec}";`);
        }
        const bySpec = new Map<string, string[]>();
        for (const r of redirected) {
          const list = bySpec.get(r.spec);
          if (list) list.push(r.name);
          else bySpec.set(r.spec, [r.name]);
        }
        for (const [s, names] of bySpec) parts.push(`import { ${names.join(", ")} } from "${s}";`);
        const list = rewrites.get(f.path) ?? [];
        list.push({ from: statement, to: parts.join("\n") });
        rewrites.set(f.path, list);
      }

      if (needStub.length === 0) continue;

      let targetStubs = stubs.get(target);
      if (!targetStubs) {
        targetStubs = new Map();
        stubs.set(target, targetStubs);
      }
      for (const s of needStub) targetStubs.set(s.name, s.reason);
      stripped.push({ file: f.path, spec, names: needStub.map((s) => s.name) });
    }
  }

  for (const [path, list] of rewrites) {
    const file = outByPath.get(path);
    if (!file) continue;
    for (const r of list) file.content = file.content.replace(r.from, r.to);
  }

  // Inject stubs into target files and promote the name from typeOnly→value
  // so subsequent passes (and future calls) see it as a value export.
  for (const [target, names] of stubs) {
    const file = outByPath.get(target);
    if (!file) continue;
    const exp = exportsOf(target);
    const lines: string[] = [];
    for (const [n, reason] of names) {
      if (exp.value.has(n)) continue;
      // Never inject the same stub twice (stubs are ignored by collectExports).
      if (new RegExp(`export const ${n}: any =`).test(file.content)) continue;
      const reasonText = reason === "type-only"
        ? "was declared only as a type/interface"
        : "was imported as a named value but is not exported by this module";
      lines.push(
        `// Auto-injected runtime stub: \`${n}\` ${reasonText} ` +
        `but imported as a value. Renders children as a passthrough so the preview does not crash.`,
      );
      // A missing HOOK must not be stubbed as a component: callers destructure
      // its result (`const { user } = useAuth()`), and a component stub returns
      // null, which crashes the page with "Cannot destructure property of null".
      lines.push(
        /^use[A-Z]/.test(n)
          ? `export const ${n}: any = (..._args: any[]) => ({});`
          : `export const ${n}: any = (props: any) => (props && props.children) ? props.children : null;`,
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
