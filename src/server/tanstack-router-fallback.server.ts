/**
 * Deterministic repair for TanStack Router primitives used with NO TanStack
 * router instance mounted.
 *
 * Production failure mode (minified):
 *   `null is not an object (evaluating 'n.stores')`
 *
 * TanStack Router's hooks (`useRouter`, `useRouterState`, `useNavigate`,
 * `useParams`, `useSearch`) and `<Link>` all read the router instance from
 * context and immediately touch `router.stores`. With no `<RouterProvider>`
 * / `createRouter()` anywhere in the graph that context is `null`, so the
 * very first render throws — the build succeeds, only the browser sees it.
 *
 * Generated Petal apps standardise on react-router-dom. When a build ends up
 * with TanStack consumers but no TanStack router, the safe deterministic fix
 * is to point those imports at a tiny compatibility shim implemented on top
 * of react-router-dom. The existing router-provider pass then guarantees a
 * `<BrowserRouter>` wraps the root render.
 */

import type { ProjectFile } from "./generate.server";

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs)$/i;
const TANSTACK_SPEC = /["']@tanstack\/react-router["']/;
const SHIM_PATH = "src/lib/router-compat.tsx";
const SHIM_SPEC = "@/lib/router-compat";
const ROUTER_PATH = "src/router.tsx";

/** Symbols the shim can stand in for. */
const SHIMMED = new Set([
  "Link",
  "Outlet",
  "Navigate",
  "useNavigate",
  "useRouter",
  "useRouterState",
  "useParams",
  "useSearch",
  "useLocation",
  "useMatch",
  "useMatches",
  "redirect",
  "RouterProvider",
  "createRouter",
  "createRootRoute",
  "createRootRouteWithContext",
  "createFileRoute",
  "createLazyFileRoute",
  "getRouteApi",
]);

export interface TanstackFallbackResult {
  files: ProjectFile[];
  notes: string[];
}

/** Is a real TanStack router actually mounted in this graph? */
function routerMounted(files: ProjectFile[]): boolean {
  const executable = files.filter(
    (f) => CODE_EXT.test(f.path) && !f.path.includes("router-compat") && !/\.(?:md|mdx)$/i.test(f.path),
  );
  const createsRouter = executable.some(
    (f) =>
      /\bcreateRouter\s*\(/.test(f.content) &&
      /import[^;]*\bcreateRouter\b[^;]*from\s*["']@tanstack\/react-router["']/.test(f.content),
  );
  const mountsProvider = executable.some(
    (f) =>
      /<RouterProvider\b/.test(f.content) &&
      /import[^;]*\bRouterProvider\b[^;]*from\s*["']@tanstack\/react-router["']/.test(f.content),
  );
  return createsRouter && mountsProvider;
}

function importsTanstackRouter(files: ProjectFile[]): boolean {
  return files.some(
    (f) => CODE_EXT.test(f.path) && /\bfrom\s*["']@tanstack\/react-router["']/.test(f.content),
  );
}

function generatedRouteTree(files: ProjectFile[]): ProjectFile | undefined {
  return files.find(
    (f) => /(?:^|\/)routeTree\.gen\.(?:ts|tsx|js|jsx)$/i.test(f.path) && /export\s+(?:const|var|let)\s+routeTree\b/.test(f.content),
  );
}

/**
 * A real TanStack-generated tree wires every file route to its parent with
 * `.update({ getParentRoute: ... })`. A short hand-written tree that merely
 * imports Route objects and calls `root.addChildren([...])` builds, but its
 * children still have no parentRoute and TanStack throws `Invariant failed`
 * while initializing them.
 */
function hasValidGeneratedRouteTree(files: ProjectFile[]): boolean {
  const tree = generatedRouteTree(files);
  if (!tree) return false;
  const hasFileRoutes = files.some(
    (f) => /^src\/routes\/.+\.(?:tsx|jsx)$/i.test(f.path) && /\bcreateFileRoute\s*\(/.test(f.content),
  );
  if (!hasFileRoutes) return true;
  return /\.update\s*\(\s*\{[\s\S]*?getParentRoute\s*:/.test(tree.content);
}

function restoreTanstackBootstrap(files: ProjectFile[]): TanstackFallbackResult | null {
  if (!hasValidGeneratedRouteTree(files)) return null;
  const main = files.find((f) => /src\/main\.(?:tsx|jsx)$/i.test(f.path) && /\.render\s*\(/.test(f.content));
  if (!main || !/<App\s*\/>/.test(main.content)) return null;

  let mainContent = main.content.replace(/<App\s*\/>/, "<RouterProvider router={router} />");
  if (!/import[^;]*\bRouterProvider\b[^;]*from\s*["']@tanstack\/react-router["']/.test(mainContent)) {
    mainContent = `import { RouterProvider } from "@tanstack/react-router";\n${mainContent}`;
  }
  if (!/import[^;]*\brouter\b[^;]*from\s*["'].\/router["']/.test(mainContent)) {
    mainContent = `import { router } from "./router";\n${mainContent}`;
  }

  const routerSource = `import { createRouter } from "@tanstack/react-router";\nimport { routeTree } from "./routeTree.gen";\n\nexport const router = createRouter({ routeTree });\n`;
  const routerExists = files.some((f) => f.path === ROUTER_PATH);
  const next = files.map((f) => {
    if (f.path === main.path) return { ...f, content: mainContent };
    if (f.path === ROUTER_PATH) return { ...f, content: routerSource };
    return f;
  });
  if (!routerExists) next.push({ path: ROUTER_PATH, content: routerSource });

  return {
    files: next,
    notes: [
      "tanstack-router-fallback: restored the missing router bootstrap from the generated route tree",
    ],
  };
}

/**
 * Does the bootstrap import a `routeTree` module that does not exist?
 *
 * Production failure mode (minified TanStack build):
 *   `Invariant failed`
 *
 * `createRouter({ routeTree: undefined })` passes the build (the missing
 * module is aliased away / tree-shaken) but TanStack asserts on the route
 * tree during the first render and throws a message-less invariant.
 */
function routeTreeImportBroken(files: ProjectFile[]): boolean {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const exts = ["", ".ts", ".tsx", ".js", ".jsx"];
  for (const f of files) {
    if (!CODE_EXT.test(f.path)) continue;
    const rx = /import\s*\{[^}]*\brouteTree\b[^}]*\}\s*from\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(f.content))) {
      const spec = m[1];
      const dir = f.path.split("/").slice(0, -1).join("/");
      const base = spec.startsWith(".")
        ? normalize(`${dir}/${spec}`)
        : spec.replace(/^@\//, "src/");
      const target = exts.map((e) => base + e).find((path) => byPath.has(path));
      if (!target) return true;
      if (!/export\s+(?:const|var|let)\s+routeTree\b/.test(byPath.get(target) ?? "")) return true;
      if (/routeTree\.gen$/i.test(base) && !hasValidGeneratedRouteTree(files)) return true;
    }
  }
  return false;
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Tear a broken TanStack bootstrap back down to a plain `<App />` render so
 *  the shim + BrowserRouter passes can take over. */
function dismantleBrokenBootstrap(files: ProjectFile[]): ProjectFile[] {
  const hasApp = files.some((f) => /^src\/App\.(tsx|jsx)$/i.test(f.path));
  return files
    .filter((f) => f.path !== ROUTER_PATH)
    .map((f) => {
      if (!/src\/main\.(?:tsx|jsx)$/i.test(f.path)) return f;
      let c = f.content
        .replace(/import\s*\{[^}]*\bRouterProvider\b[^}]*\}\s*from\s*["']@tanstack\/react-router["'];?\n?/g, "")
        .replace(/import\s*\{[^}]*\brouter\b[^}]*\}\s*from\s*["']\.\/router["'];?\n?/g, "")
        .replace(/<RouterProvider\b[^>]*\/>/g, hasApp ? "<App />" : "<div />");
      if (hasApp && !/import\s+App\s+from/.test(c)) c = `import App from "./App";\n${c}`;
      return { ...f, content: c };
    });
}

/** URL path for a file-based TanStack route module. */
function routeUrlFromPath(path: string): string | null {
  const rel = path.replace(/^src\/routes\//, "").replace(/\.(tsx|jsx|ts|js)$/i, "");
  if (rel === "__root" || rel.startsWith("-")) return null;
  const segs = rel
    .split("/")
    .flatMap((s) => s.split("."))
    .filter((s) => s && s !== "index" && !s.startsWith("_"))
    .map((s) => (s.startsWith("$") ? (s === "$" ? "*" : `:${s.slice(1)}`) : s));
  return "/" + segs.join("/");
}

/**
 * Build a react-router route table from file-based TanStack route modules.
 * Their `Route` exports become inert objects under the shim, so we read the
 * `component` off them and mount it with react-router instead.
 */
function buildFileRouteTable(files: ProjectFile[]): TanstackFallbackResult | null {
  const routeFiles = files.filter(
    (f) => /^src\/routes\/.+\.(tsx|jsx)$/i.test(f.path) && /\bcreateFileRoute\s*\(/.test(f.content),
  );
  if (routeFiles.length === 0) return null;
  const main = files.find((f) => /src\/main\.(?:tsx|jsx)$/i.test(f.path) && /\.render\s*\(/.test(f.content));
  if (!main) return null;

  const hasApp = files.some((f) => /^src\/App\.(tsx|jsx)$/i.test(f.path));
  const entries = routeFiles
    .map((f, i) => ({ url: routeUrlFromPath(f.path), spec: "@/" + f.path.replace(/^src\//, "").replace(/\.(tsx|jsx)$/i, ""), id: `R${i}` }))
    .filter((e): e is { url: string; spec: string; id: string } => e.url !== null)
    // Static segments before dynamic ones so `/products/new` wins over `/products/:slug`.
    .sort((a, b) => Number(a.url.includes(":")) - Number(b.url.includes(":")));

  if (entries.length === 0) return null;

  const imports = entries.map((e) => `import { Route as ${e.id} } from "${e.spec}";`).join("\n");
  const consts = entries
    .map((e) => {
      const routeVar = `Route${e.id}`;
      return `const ${routeVar} = ${e.id} as any;\nconst C${e.id} = ${routeVar}?.component ?? (() => null);`;
    })
    .join("\n");
  const children = entries
    .map((e) => `      <RRRoute path="${e.url}" element={<RouteContext.Provider value={Route${e.id}}><C${e.id} /></RouteContext.Provider>} />`)
    .join("\n");

  const body = hasApp
    ? `    <RRRoute element={<App />}>\n${children}\n    </RRRoute>`
    : children;

  const content = `/**
 * Auto-generated route table.
 *
 * This app declares file-based TanStack routes but has no generated route
 * tree, so the TanStack router could not be constructed. These routes are
 * mounted with react-router instead, which keeps every page reachable.
 */
import { createContext, useContext } from "react";
import { BrowserRouter, Routes, Route as RRRoute } from "react-router-dom";
${hasApp ? 'import App from "@/App";\n' : ""}${imports}

${consts}

const RouteContext = createContext<any>(null);

export function GeneratedRoutes() {
  return (
    <BrowserRouter>
      <Routes>
${body}
      </Routes>
    </BrowserRouter>
  );
}

export function useCurrentRoute() {
  return useContext(RouteContext);
}
`;

  const routesPath = "src/generated-routes.tsx";
  let mainContent = main.content.replace(/<App\s*\/>/, "<GeneratedRoutes />");
  const alreadyUsesGeneratedRoutes = /<GeneratedRoutes\s*\/>/.test(mainContent);
  if (mainContent === main.content && !alreadyUsesGeneratedRoutes) return null;
  mainContent = mainContent.replace(/import\s+App\s+from\s*["'][^"']+["'];?\n?/, "");
  if (!/import\s*\{[^}]*\bGeneratedRoutes\b[^}]*\}\s*from\s*["']\.\/generated-routes["']/.test(mainContent)) {
    mainContent = `import { GeneratedRoutes } from "./generated-routes";\n${mainContent}`;
  }

  const next = files
    .filter((f) => f.path !== routesPath)
    .map((f) => (f.path === main.path ? { ...f, content: mainContent } : f));
  next.push({ path: routesPath, content });

  return {
    files: next,
    notes: [
      `tanstack-router-fallback: mounted ${entries.length} file-based route(s) through react-router (no generated route tree)`,
    ],
  };
}

export function fixTanstackRouterWithoutProvider(files: ProjectFile[]): TanstackFallbackResult {
  const notes: string[] = [];
  // Idempotent recovery: an earlier import-resolver pass may have created a
  // default-only placeholder for `./generated-routes` after the first router
  // repair rewrote TanStack imports to the compatibility shim. On subsequent
  // runs there are no @tanstack imports left, so repair that stale generated
  // module before the normal early return below.
  const mainUsesGeneratedRoutes = files.some(
    (f) => /src\/main\.(?:tsx|jsx)$/i.test(f.path) && /<GeneratedRoutes\s*\/>/.test(f.content),
  );
  const validGeneratedRoutes = files.some(
    (f) => f.path === "src/generated-routes.tsx" && /export\s+function\s+GeneratedRoutes\b/.test(f.content),
  );
  if (mainUsesGeneratedRoutes && !validGeneratedRoutes) {
    const regenerated = buildFileRouteTable(
      files.filter((f) => f.path !== "src/generated-routes.tsx"),
    );
    if (regenerated) return regenerated;
  }
  const importsCompatShim = files.some(
    (f) => CODE_EXT.test(f.path) && /from\s*["']@\/lib\/router-compat["']/.test(f.content),
  );
  const validCompatShim = files.some(
    (f) => f.path === SHIM_PATH && /export\s+function\s+Link\b/.test(f.content),
  );
  if (importsCompatShim && !validCompatShim) {
    return {
      files: [
        ...files.filter((f) => f.path !== SHIM_PATH),
        { path: SHIM_PATH, content: SHIM_SOURCE },
      ],
      notes: ["tanstack-router-fallback: restored the router compatibility shim"],
    };
  }
  if (!importsTanstackRouter(files)) return { files, notes };

  let working = files;
  if (routerMounted(files)) {
    // A mounted router that points at a missing route tree throws
    // "Invariant failed" on first render. Tear it down and fall through to
    // the deterministic react-router path below.
    if (!routeTreeImportBroken(files)) return { files, notes };
    working = dismantleBrokenBootstrap(files);
    notes.push(
      "tanstack-router-fallback: removed a router bootstrap that pointed at a missing route tree",
    );
  } else {
    // A generated route tree means this is a real file-based TanStack app whose
    // entry point was lost or replaced. Restore the real provider so route
    // loaders, params, nested layouts, and head metadata continue to work.
    const restored = restoreTanstackBootstrap(files);
    if (restored) return restored;
  }

  const table = buildFileRouteTable(working);
  if (table) {
    working = table.files;
    notes.push(...table.notes);
  }

  const rewritten: string[] = [];
  const out = working.map((f) => {
    if (!CODE_EXT.test(f.path)) return f;
    if (!TANSTACK_SPEC.test(f.content)) return f;

    const next = f.content.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']@tanstack\/react-router["'];?/g,
      (full, inner: string) => {
        const names = inner
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        if (names.length === 0) return full;
        // Only redirect when every imported symbol has a shim equivalent;
        // otherwise leave the statement untouched so nothing silently breaks.
        const base = names.map((n) => n.split(/\s+as\s+/)[0].trim());
        if (!base.every((n) => SHIMMED.has(n))) return full;
        return `import { ${names.join(", ")} } from "${SHIM_SPEC}";`;
      },
    );
    if (next === f.content) return f;
    rewritten.push(f.path);
    return { ...f, content: next };
  });

  if (rewritten.length === 0) return { files: working, notes };

  const withShim = out.some((f) => f.path === SHIM_PATH)
    ? out
    : [...out, { path: SHIM_PATH, content: SHIM_SOURCE }];

  notes.push(
    `tanstack-router-fallback: no router mounted — routed ${rewritten.length} file(s) through the react-router compatibility shim`,
  );
  return { files: withShim, notes };
}

const SHIM_SOURCE = `/**
 * Auto-generated compatibility shim.
 *
 * This app used TanStack Router APIs without mounting a TanStack router,
 * which crashes at render time. These wrappers provide the same call
 * signatures on top of react-router-dom, which IS mounted.
 */
import type { ReactNode } from "react";
import {
  Link as RRLink,
  Navigate as RRNavigate,
  Outlet,
  useLocation,
  useNavigate as useRRNavigate,
  useParams as useRRParams,
  useSearchParams,
} from "react-router-dom";

type To = string | { to?: string; href?: string; search?: Record<string, unknown>; hash?: string };

function toPath(target: To | undefined): string {
  if (!target) return "/";
  if (typeof target === "string") return target;
  const base = target.to ?? target.href ?? "/";
  const search =
    target.search && Object.keys(target.search).length > 0
      ? "?" + new URLSearchParams(target.search as Record<string, string>).toString()
      : "";
  const hash = target.hash ? (target.hash.startsWith("#") ? target.hash : "#" + target.hash) : "";
  return base + search + hash;
}

export function Link({ to, params, search, hash, children, ...rest }: any & { children?: ReactNode }) {
  void params;
  return (
    <RRLink to={toPath({ to, search, hash })} {...rest}>
      {children}
    </RRLink>
  );
}

export function Navigate({ to, search, hash, ...rest }: any) {
  return <RRNavigate to={toPath({ to, search, hash })} {...rest} />;
}

export function useNavigate() {
  const navigate = useRRNavigate();
  return (target?: To, options?: { replace?: boolean }) =>
    navigate(toPath(target), { replace: options?.replace });
}

export function useParams(): any {
  return useRRParams();
}

export function useSearch(): any {
  const [params] = useSearchParams();
  return Object.fromEntries(params.entries());
}

export function useRouterState(opts?: { select?: (state: any) => any }) {
  const location = useLocation();
  const state = { location, matches: [], status: "idle" as const };
  return opts?.select ? opts.select(state) : state;
}

export function useRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  return {
    navigate,
    state: { location, matches: [] },
    history: {
      back: () => window.history.back(),
      go: (delta: number) => window.history.go(delta),
    },
  };
}

export function useMatch(): any {
  return { params: useRRParams(), search: {} };
}

export function useMatches(): any[] {
  return [];
}

export function redirect(target: To) {
  return { to: toPath(target) };
}

/** Route-definition helpers become inert factories: the react-router route
 *  table is what actually renders, so these must not throw when imported. */
export function createFileRoute(_path?: string) {
  return (options: any) => ({
    ...options,
    path: _path,
    useLoaderData: () => {
      const params = useRRParams();
      return options?.loader ? options.loader({ params }) : undefined;
    },
    useParams: useRRParams,
    useSearch,
    useNavigate,
  });
}

export const createLazyFileRoute = createFileRoute;

export function createRootRoute(options: any = {}) {
  return { ...options };
}

export function createRootRouteWithContext() {
  return (options: any = {}) => ({ ...options });
}

export function getRouteApi(_id?: string) {
  return { useParams: useRRParams, useSearch, useNavigate, useLoaderData: () => undefined };
}

export function createRouter(options: any = {}) {
  return { ...options };
}

export function RouterProvider({ children }: { children?: ReactNode }) {
  return <>{children ?? <Outlet />}</>;
}

export { Outlet, useLocation };
`;
