/**
 * Impact graph (Engine 3.0, phase 4).
 *
 * Given the project's files and a set of seed paths the edit is aimed at, work
 * out which OTHER files that edit can realistically break: the modules a seed
 * imports (its dependencies) and the modules that import a seed (its
 * dependents). Those are exactly the files that must be pinned into prompt
 * context so the model's `replace` snippets match real bytes instead of
 * hallucinations.
 *
 * Deterministic, pure, and dependency-free: a regex import scan plus a BFS.
 * No model call, no I/O, so it is cheap enough to run on every edit turn and
 * trivially unit-testable.
 */

export interface GraphFile {
  path: string;
  content: string;
}

export interface ImpactResult {
  /** Seeds plus everything reachable within the requested radius. */
  paths: string[];
  /** Files that import a seed (blast radius of the change). */
  dependents: string[];
  /** Files a seed imports (what the change relies on). */
  dependencies: string[];
}

const IMPORT_RE =
  /(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*|require\(\s*)['"]([^'"]+)['"]/g;

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function norm(p: string): string {
  return p.replace(/^\.?\//, "");
}

/** Resolve one import specifier against the project's real file list. */
export function resolveSpecifier(
  from: string,
  spec: string,
  known: Set<string>,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = `src/${spec.slice(2)}`;
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = norm(from).split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else {
    return null; // bare package import — not part of the project graph
  }
  for (const ext of EXTS) {
    const candidate = norm(base + ext);
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** path -> the project files it imports. */
export function buildImportGraph(files: GraphFile[]): Map<string, string[]> {
  const known = new Set(files.map((f) => norm(f.path)));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const path = norm(file.path);
    if (!/\.(t|j)sx?$/.test(path)) continue;
    const out = new Set<string>();
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(file.content))) {
      const resolved = resolveSpecifier(path, m[1], known);
      if (resolved && resolved !== path) out.add(resolved);
    }
    graph.set(path, [...out]);
  }
  return graph;
}

/**
 * Expand seeds into the files an edit can plausibly touch.
 *
 * `radius` is hop count in each direction (1 = immediate neighbours), `max`
 * caps the total so a hub module like `App.tsx` can never drag the whole
 * project into the prompt.
 */
export function computeImpact(
  files: GraphFile[],
  seeds: string[],
  opts: { radius?: number; max?: number } = {},
): ImpactResult {
  const radius = Math.max(1, opts.radius ?? 1);
  const max = Math.max(1, opts.max ?? 24);
  const graph = buildImportGraph(files);
  const seedSet = new Set(seeds.map(norm).filter((p) => graph.has(p)));
  if (seedSet.size === 0) return { paths: [], dependents: [], dependencies: [] };

  const reverse = new Map<string, string[]>();
  for (const [from, tos] of graph) {
    for (const to of tos) {
      const list = reverse.get(to) ?? [];
      list.push(from);
      reverse.set(to, list);
    }
  }

  const walk = (edges: Map<string, string[]>): string[] => {
    const seen = new Set(seedSet);
    let frontier = [...seedSet];
    const out: string[] = [];
    for (let hop = 0; hop < radius && frontier.length; hop++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbour of edges.get(node) ?? []) {
          if (seen.has(neighbour)) continue;
          seen.add(neighbour);
          out.push(neighbour);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return out;
  };

  const dependencies = walk(graph);
  const dependents = walk(reverse);
  // Dependents first: breaking a caller is the failure users actually see.
  const paths = [...seedSet, ...dependents, ...dependencies]
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, max);

  return { paths, dependents, dependencies };
}
