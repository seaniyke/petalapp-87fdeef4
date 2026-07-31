/**
 * Component-rendered-as-child repair.
 *
 * Root cause this addresses: React error #31 —
 *   "Objects are not valid as a React child (found: object with keys
 *    {$$typeof, render, displayName})"
 *
 * Those three keys are the shape of a `forwardRef` component object, which is
 * exactly what every `lucide-react` icon is. The model writes data arrays like
 *
 *   const features = [{ title: "Fast", icon: Zap }, …];
 *
 * and then renders the icon in child position instead of instantiating it:
 *
 *   <span>{feature.icon}</span>        // ← crashes the whole tree
 *   <span><feature.icon /></span>      // ← what it meant
 *
 * The crash happens at render, so the entire preview goes white — there is no
 * partial page. It is one of the highest-frequency generated-code faults and
 * it is fully deterministic to repair.
 *
 * Strategy: route suspicious child expressions through a tiny runtime helper
 * (`renderNode`) rather than rewriting them into JSX. A static rewrite has to
 * *know* whether the value is a component or an already-built element, and it
 * cannot — `icon` is sometimes `Zap` and sometimes `<Zap className="w-4" />`.
 * `renderNode` decides at runtime and returns `null` for anything unrenderable,
 * so this pass can never turn a working page into a crashing one.
 */

import type { ProjectFile } from "./generate.server";

const HELPER_PATH = "src/lib/render-node.tsx";
const HELPER_IMPORT = '@/lib/render-node';

const HELPER_SOURCE = `import { createElement, isValidElement, type ReactNode } from "react";

/**
 * Render a value that may be a component reference, an element, or plain text.
 *
 * Guards against React error #31 ("Objects are not valid as a React child"),
 * which fires when a component object — e.g. a lucide-react icon, which is a
 * forwardRef object with keys {$$typeof, render, displayName} — is placed in
 * child position instead of being instantiated.
 */
export function renderNode(value: unknown, props?: Record<string, unknown>): ReactNode {
  if (value === null || value === undefined || value === false || value === true) return null;
  if (isValidElement(value)) return value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "function") {
    return createElement(value as never, props as never);
  }
  if (typeof value === "object") {
    // forwardRef / memo / lazy component objects all carry a symbol $$typeof.
    if (typeof (value as { $$typeof?: unknown }).$$typeof === "symbol") {
      return createElement(value as never, props as never);
    }
    // Anything else (a plain data object) would crash React. Render nothing.
    return null;
  }
  return null;
}

export default renderNode;
`;

/**
 * Member-expression tails that indicate "this holds a component, not text".
 * Deliberately narrow: `item.title` or `item.name` must never be touched.
 */
const COMPONENT_KEYS = new Set([
  "icon",
  "Icon",
  "logo",
  "Logo",
  "image",
  "Image",
  "component",
  "Component",
  "element",
  "Element",
  "avatar",
  "glyph",
  "symbol",
]);

/** Packages whose default exports are always components. */
const COMPONENT_PACKAGES = [/lucide-react/, /react-icons/, /@radix-ui\//];

/** Collect capitalized identifiers imported from icon/component packages. */
function collectComponentImports(source: string): Set<string> {
  const names = new Set<string>();
  const importRe = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source))) {
    const clause = m[1];
    const spec = m[2];
    if (!COMPONENT_PACKAGES.some((re) => re.test(spec))) continue;
    const braced = clause.match(/\{([^}]*)\}/);
    const parts = braced ? braced[1].split(",") : clause.split(",");
    for (const raw of parts) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Z][A-Za-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** True when this expression is very likely a component reference. */
function looksLikeComponentRef(expr: string, componentImports: Set<string>): boolean {
  // Never touch anything with a call, ternary, JSX, or operator in it — those
  // are already producing a value and the helper would add nothing but noise.
  if (/[()<>?:!+\-*/&|[\]]/.test(expr)) return false;

  if (expr.includes(".")) {
    const tail = expr.split(".").pop() ?? "";
    return COMPONENT_KEYS.has(tail);
  }
  return componentImports.has(expr);
}

function rewriteFile(source: string): { content: string; changes: number } {
  const componentImports = collectComponentImports(source);
  let changes = 0;

  // Only JSX *child* position: `>{ expr }<`. Attribute values (`icon={Zap}`)
  // are correct usage and must be left alone.
  const childExpr = /(>[ \t\r\n]*)\{[ \t\r\n]*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)[ \t\r\n]*\}(?=[ \t\r\n]*<)/g;

  const out = source.replace(childExpr, (full, lead: string, expr: string) => {
    if (!looksLikeComponentRef(expr, componentImports)) return full;
    changes++;
    return `${lead}{renderNode(${expr})}`;
  });

  if (changes === 0) return { content: source, changes: 0 };

  // Inject the helper import once, after the final existing import.
  if (!/from\s+["']@\/lib\/render-node["']/.test(out)) {
    const imports = [...out.matchAll(/^import[^\n]*from\s+["'][^"']+["'];?[ \t]*$/gm)];
    const line = `import { renderNode } from "${HELPER_IMPORT}";`;
    if (imports.length > 0) {
      const last = imports[imports.length - 1];
      const at = (last.index ?? 0) + last[0].length;
      return { content: `${out.slice(0, at)}\n${line}${out.slice(at)}`, changes };
    }
    return { content: `${line}\n${out}`, changes };
  }

  return { content: out, changes };
}

export function fixComponentChildren(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const notes: string[] = [];
  let total = 0;
  let touched = 0;

  const next = files.map((f) => {
    if (!/\.(tsx|jsx)$/.test(f.path)) return f;
    if (f.path === HELPER_PATH) return f;
    const { content, changes } = rewriteFile(f.content);
    if (changes === 0) return f;
    total += changes;
    touched++;
    return { ...f, content };
  });

  if (total === 0) return { files, notes };

  if (!next.some((f) => f.path === HELPER_PATH)) {
    next.push({ path: HELPER_PATH, content: HELPER_SOURCE });
  }

  notes.push(
    `component-child: guarded ${total} component-as-child render(s) across ${touched} file(s) (React #31)`,
  );
  return { files: next, notes };
}
