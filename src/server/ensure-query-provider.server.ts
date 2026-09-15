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
