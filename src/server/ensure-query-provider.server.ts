/**
 * Guarantee a QueryClientProvider when the app uses TanStack Query.
 *
 * Seen in production: a generated dashboard called `useQuery` while
 * `src/main.tsx` rendered `<App />` bare, so the page crashed at runtime with
 * "No QueryClient set, use QueryClientProvider to set one" and the build was
 * blocked by the pre-deploy browser check.
 *
 * Deterministic, idempotent, and fail-open: when the root file has an
 * unexpected shape we leave it untouched.
 */
import type { ProjectFile } from "@/server/generate.server";

const QUERY_HOOK_RE = /\buse(?:Query|Mutation|QueryClient|InfiniteQuery|Queries|SuspenseQuery)\b/;
const ROOT_CANDIDATES = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx"];

/** Resolve a local import specifier to a project file path. */
function resolveLocal(fromPath: string, spec: string, byPath: Map<string, ProjectFile>): ProjectFile | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const c of [base, `${base}.tsx`, `${base}.jsx`, `${base}.ts`, `${base}/index.tsx`]) {
    const hit = byPath.get(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * True when the root file itself renders a QueryClientProvider, or renders a
 * component imported from a module that provides one.
 */
function alreadyProvided(root: ProjectFile, files: ProjectFile[]): boolean {
  if (root.content.includes("<QueryClientProvider")) return true;
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const importRe = /import\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))[^"']*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(root.content))) {
    const names = [
      ...(m[1] ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/i).pop()!.trim()) : []),
      ...(m[2] ? [m[2]] : []),
    ].filter((n) => /^[A-Z]/.test(n));
    if (names.length === 0) continue;
    const rendered = names.some((n) => new RegExp(`<${n}[\\s/>]`).test(root.content));
    if (!rendered) continue;
    const target = resolveLocal(root.path, m[3], byPath);
    if (target && typeof target.content === "string" && target.content.includes("<QueryClientProvider")) {
      return true;
    }
  }
  return false;
}

export function ensureQueryProvider(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const usesQuery = files.some(
    (f) =>
      /\.(tsx?|jsx?)$/.test(f.path) &&
      typeof f.content === "string" &&
      f.content.includes("@tanstack/react-query") &&
      QUERY_HOOK_RE.test(f.content),
  );
  if (!usesQuery) return { files, notes: [] };

  const root = files.find((f) => ROOT_CANDIDATES.includes(f.path));
  if (!root || typeof root.content !== "string") return { files, notes: [] };

  // "Provided" means provided ON THE RENDER PATH. The scaffold ships an
  // unused `app-providers.tsx` that contains <QueryClientProvider>, so a
  // project-wide search always matched and the root never got wrapped — the
  // exact crash this pass exists to prevent.
  if (alreadyProvided(root, files)) return { files, notes: [] };

  const appTag = /<App\s*\/>/;
  if (!appTag.test(root.content)) return { files, notes: [] };


  let content = root.content.replace(
    appTag,
    "<QueryClientProvider client={queryClient}>\n      <App />\n    </QueryClientProvider>",
  );

  if (!/from\s+["']@tanstack\/react-query["']/.test(content)) {
    content = `import { QueryClient, QueryClientProvider } from "@tanstack/react-query";\n${content}`;
  }
  if (!/new QueryClient\s*\(/.test(content)) {
    const lastImport = content.lastIndexOf("\nimport ");
    const insertAt = lastImport === -1 ? 0 : content.indexOf("\n", lastImport + 1) + 1;
    content = `${content.slice(0, insertAt)}\nconst queryClient = new QueryClient();\n${content.slice(insertAt)}`;
  }

  return {
    files: files.map((f) => (f.path === root.path ? { ...f, content } : f)),
    notes: ["query-provider: wrapped the app root in QueryClientProvider"],
  };
}
