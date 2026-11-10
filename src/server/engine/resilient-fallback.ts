/**
 * Resilient delivery fallback: what a file that still fails verification at
 * commit is replaced with, so one broken optional page never discards a
 * whole build. Pure and deterministic.
 *
 * - Prior verified content (baseline) always wins.
 * - A non-critical PAGE (src/pages/*.tsx with a default export) gets a clean,
 *   compiling placeholder page.
 * - Everything else (entry, app shell, shared modules, components) → null:
 *   never substituted, the normal verdict stands.
 */
import { structurallyCriticalPaths } from "./structural-deps";

type F = { path: string; content: string };

const PAGE_RE = /^src\/pages\/(?:[\w-]+\/)*([\w-]+)\.tsx$/;

function titleFor(path: string): string {
  const m = PAGE_RE.exec(path);
  const base = (m?.[1] ?? "Page").replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return base.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || "Page";
}

export function placeholderPage(path: string): string {
  const title = titleFor(path);
  const name = title.replace(/[^A-Za-z0-9]/g, "") || "Page";
  const comp = /^[A-Za-z]/.test(name) ? `${name}Page` : `Page${name}`;
  return `export default function ${comp}() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">${title.replace(/[{}<>`]/g, "")}</h1>
      <p className="mt-4 text-muted-foreground">This page is being finished. Please check back shortly.</p>
    </main>
  );
}
`;
}

export function resilientFallback(path: string, tree: F[], baseline: F[]): string | null {
  const prior = baseline.find((f) => f.path === path);
  const current = tree.find((f) => f.path === path);
  if (!current) return null;
  if (structurallyCriticalPaths(tree, [path]).has(path)) {
    // Critical files may only return to prior verified content.
    return prior && prior.content !== current.content ? prior.content : null;
  }
  if (prior && prior.content !== current.content) return prior.content;
  if (PAGE_RE.test(path) && /export\s+default\b/.test(current.content)) return placeholderPage(path);
  return null;
}
