/**
 * Missing-node recovery — repair the ROOT of a broken import, not its dependents.
 *
 * When `A imports B` and B does not exist, A is usually fine: B is the missing
 * node. This module finds every missing import target across the scoped files,
 * groups the importers per target, and creates each missing shared module ONCE
 * (one call per module, never one call per importing page). Every created
 * module must export every name its importers ask for, and still passes the
 * normal source/build gates afterwards.
 *
 * Pages are never created here — the WRITE stage owns pages. Kit primitives
 * (`@/components/ui/*`, `@/components/blocks/*`) and generated integration
 * clients are never invented either; those stay verifier failures.
 */
import type { ProjectFile } from "@/server/generate.server";
import { resolveSpecifier } from "@/server/engine/structural-deps";

export interface MissingImporter {
  path: string;
  named: string[];
  hasDefault: boolean;
  /** The importer's own import statement, verbatim. */
  statement: string;
}

export interface MissingNode {
  /** Path the module will be created at. */
  target: string;
  spec: string;
  importers: MissingImporter[];
}

export interface MissingNodeResult {
  files: ProjectFile[];
  created: string[];
  /** Missing modules that could not be created safely — the exact blocker. */
  blocked: Array<{ target: string; reason: string; importers: string[] }>;
}

export type CreateModule = (node: MissingNode, context: string) => Promise<string | null>;

const IMPORT_STMT = /import\s+(type\s+)?([\w$]+)?\s*,?\s*(\{[^}]*\})?\s*(?:\*\s+as\s+[\w$]+\s*)?from\s*["']([^"']+)["'];?/g;
const NEVER_CREATE = [/^@\/components\/ui\//, /^@\/components\/blocks\//, /^@\/integrations\/supabase\//, /^@\/pages\//];

function isSource(p: string): boolean {
  return /\.(tsx?|jsx?)$/.test(p);
}

function targetFor(from: string, spec: string, named: string[], hasDefault: boolean): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const segs: string[] = [];
    for (const s of `${from.split("/").slice(0, -1).join("/")}/${spec}`.split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") segs.pop();
      else segs.push(s);
    }
    base = segs.join("/");
  } else return null;
  if (/\.(tsx?|jsx?|css|json|svg|png|jpe?g|webp)$/.test(base)) return /\.(tsx?|jsx?)$/.test(base) ? base : null;
  if (base.startsWith("src/pages/")) return null;
  // JSX-bearing modules (components, providers, contexts) → .tsx; plain logic → .ts.
  const jsx =
    hasDefault ||
    /context|provider|components?\//i.test(base) ||
    named.some((n) => /^[A-Z]/.test(n) && !/^[A-Z][A-Z0-9_]+$/.test(n) && !/Type$|Props$/.test(n));
  return `${base}${jsx ? ".tsx" : ".ts"}`;
}

/** Pure: every missing import target referenced by the scoped files. */
export function findMissingNodes(files: ProjectFile[], scopePaths: string[]): MissingNode[] {
  const paths = new Set(files.map((f) => f.path));
  const scope = new Set(scopePaths);
  const byTarget = new Map<string, MissingNode>();
  for (const f of files) {
    if (!scope.has(f.path) || !isSource(f.path)) continue;
    IMPORT_STMT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_STMT.exec(f.content))) {
      const spec = m[4]!;
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      if (NEVER_CREATE.some((re) => re.test(spec))) continue;
      if (resolveSpecifier(f.path, spec, paths)) continue;
      const named = (m[3] ?? "")
        .replace(/[{}]/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean);
      const hasDefault = Boolean(m[2]);
      const target = targetFor(f.path, spec, named, hasDefault);
      if (!target) continue;
      const key = target.replace(/\.(tsx?|jsx?)$/, "");
      const node = byTarget.get(key) ?? { target, spec, importers: [] };
      node.importers.push({ path: f.path, named, hasDefault, statement: m[0] });
      if (target.endsWith(".tsx")) node.target = target;
      byTarget.set(key, node);
    }
  }
  return Array.from(byTarget.values());
}

/** Every exported name the created module must provide. */
export function requiredExports(node: MissingNode): { named: string[]; needsDefault: boolean } {
  const named = Array.from(new Set(node.importers.flatMap((i) => i.named)));
  return { named, needsDefault: node.importers.some((i) => i.hasDefault) };
}

/** Pure: does `content` export everything the importers ask for? */
export function exportsSatisfy(content: string, node: MissingNode): string[] {
  const { named, needsDefault } = requiredExports(node);
  const missing: string[] = [];
  for (const n of named) {
    const re = new RegExp(
      `export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|type|interface|enum)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`,
    );
    if (!re.test(content)) missing.push(n);
  }
  if (needsDefault && !/export\s+default\b/.test(content)) missing.push("default export");
  return missing;
}

/** Compact usage context for the creator: importer statements + usage lines. */
export function usageContext(files: ProjectFile[], node: MissingNode): string {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const { named } = requiredExports(node);
  const lines: string[] = [];
  for (const imp of node.importers) {
    const src = byPath.get(imp.path) ?? "";
    const uses = src
      .split("\n")
      .filter((l) => named.some((n) => new RegExp(`\\b${n}\\b`).test(l)) && !/^\s*import\b/.test(l))
      .slice(0, 12)
      .map((l) => l.trim().slice(0, 200));
    lines.push(`// ${imp.path}\n${imp.statement}\n${uses.join("\n")}`);
  }
  const types = byPath.get("src/types.ts") ?? byPath.get("src/types/index.ts");
  if (types) lines.push(`// src/types.ts (shared types — import from "@/types")\n${types.slice(0, 4000)}`);
  return lines.join("\n\n");
}

/**
 * Create each missing shared module once. A module whose exports don't
 * satisfy its importers is rejected and reported as a blocker — dependents
 * are left untouched so the verifier reports the real root cause.
 */
export async function resolveMissingNodes(
  files: ProjectFile[],
  scopePaths: string[],
  create: CreateModule,
  opts: { concurrency?: number } = {},
): Promise<MissingNodeResult> {
  const nodes = findMissingNodes(files, scopePaths);
  const created: string[] = [];
  const blocked: MissingNodeResult["blocked"] = [];
  let out = files;
  // Missing modules are independent of each other: create them concurrently
  // (bounded), then stage in a fixed order. Provider/infrastructure failures
  // propagate — they are not evidence about the module.
  const limit = Math.max(1, opts.concurrency ?? 1);
  const contents: Array<string | null> = new Array(nodes.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < nodes.length) {
      const i = next++;
      contents[i] = await create(nodes[i]!, usageContext(files, nodes[i]!));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, nodes.length)) }, worker));
  nodes.forEach((node, i) => {
    const importers = node.importers.map((x) => x.path);
    const content = contents[i];
    if (!content || !content.trim()) {
      blocked.push({ target: node.target, reason: "no module was produced", importers });
      return;
    }
    const missing = exportsSatisfy(content, node);
    if (missing.length) {
      blocked.push({ target: node.target, reason: `created module is missing exports: ${missing.join(", ")}`, importers });
      return;
    }
    out = [...out.filter((f) => f.path !== node.target), { path: node.target, content }];
    created.push(node.target);
  });
  return { files: out, created, blocked };
}
