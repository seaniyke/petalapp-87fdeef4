/**
 * Defense-in-depth: scan project files for `@/components/ui/<name>` and
 * `@/components/blocks/<name>` imports that point at primitives the scaffold
 * does NOT ship (e.g. `carousel`, `command`, `menubar`, `sidebar`). For each
 * missing target, synthesize a permissive shim file so `vite build` succeeds
 * and the deployed app renders something instead of going blank.
 *
 * The shim is a forwardRef'd passthrough `<div>` re-exported under every
 * named binding the codebase tries to import, plus a default export. It is
 * intentionally generic — it won't look like a real carousel, but the page
 * will mount and the user can iterate. Better than a blank preview.
 */
import type { ProjectFile } from "./generate.server";

const UI_RE = /import\s+(?!type\b)([^"';]+?)\s+from\s+["'](@\/components\/(?:ui|blocks)\/[^"']+)["']/g;

function parseNamedImports(clause: string): { names: string[]; hasDefault: boolean } {
  // clause forms:
  //   Default            → "Foo"
  //   Default, { A, B }  → "Foo, { A, B as C }"
  //   { A, B as C }      → "{ A, B as C }"
  //   * as Ns            → "* as Ns" (skip — namespace imports can't be shimmed cleanly)
  const names: string[] = [];
  let hasDefault = false;
  const trimmed = clause.trim();
  if (trimmed.startsWith("*")) return { names, hasDefault: false };

  // Default part (everything before the first `{`).
  const braceStart = trimmed.indexOf("{");
  const defaultPart = (braceStart >= 0 ? trimmed.slice(0, braceStart) : trimmed)
    .replace(/,\s*$/, "")
    .trim();
  if (defaultPart && defaultPart !== ",") {
    hasDefault = true;
  }

  if (braceStart >= 0) {
    const braceEnd = trimmed.indexOf("}", braceStart);
    const inside = trimmed.slice(braceStart + 1, braceEnd);
    for (const piece of inside.split(",")) {
      const local = piece.trim().split(/\s+as\s+/)[0].trim();
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    }
  }
  return { names, hasDefault };
}

function buildShim(names: string[], hasDefault: boolean, modulePath: string): string {
  const uniq = Array.from(new Set(names));
  const exportLines = uniq.map((n) => `export const ${n}: any = Shim;`).join("\n");
  return `// Auto-generated shim for "${modulePath}". The model imported a
// primitive that the Petal scaffold does not ship. Rather than blank the
// preview, we render a passthrough <div> so the page mounts. Replace with
// a real implementation when needed.
import * as React from "react";

const Shim = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Shim({ children, ...rest }, ref) {
    return React.createElement("div", { ref, ...rest }, children);
  }
);
Shim.displayName = "PetalShim";

${exportLines}
${hasDefault ? "export default Shim;\n" : ""}`;
}

export function shimMissingUiPrimitives(files: ProjectFile[]): {
  files: ProjectFile[];
  shimmed: string[];
} {
  const byPath = new Set(files.map((f) => f.path));
  // module spec → { names, hasDefault }
  const missing = new Map<string, { names: Set<string>; hasDefault: boolean }>();

  for (const f of files) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    if (f.path.startsWith("src/components/ui/")) continue;

    let m: RegExpExecArray | null;
    UI_RE.lastIndex = 0;
    while ((m = UI_RE.exec(f.content))) {
      const clause = m[1];
      const spec = m[2]; // e.g. "@/components/ui/carousel"
      const rel = spec.replace("@/", "src/");
      const candidates = [
        `${rel}.tsx`,
        `${rel}.ts`,
        `${rel}.jsx`,
        `${rel}.js`,
        `${rel}/index.tsx`,
        `${rel}/index.ts`,
      ];
      if (candidates.some((p) => byPath.has(p))) continue;

      const { names, hasDefault } = parseNamedImports(clause);
      const entry = missing.get(spec) ?? { names: new Set(), hasDefault: false };
      for (const n of names) entry.names.add(n);
      if (hasDefault) entry.hasDefault = true;
      missing.set(spec, entry);
    }
  }

  if (missing.size === 0) return { files, shimmed: [] };

  const out = [...files];
  const shimmed: string[] = [];
  for (const [spec, info] of missing) {
    const path = `${spec.replace("@/", "src/")}.tsx`;
    out.push({
      path,
      content: buildShim(Array.from(info.names), info.hasDefault, spec),
    });
    shimmed.push(spec);
  }
  return { files: out, shimmed };
}
