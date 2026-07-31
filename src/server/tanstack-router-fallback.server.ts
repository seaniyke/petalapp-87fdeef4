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

function hasGeneratedRouteTree(files: ProjectFile[]): boolean {
  return files.some(
    (f) => /(?:^|\/)routeTree\.gen\.(?:ts|tsx|js|jsx)$/i.test(f.path) && /export\s+(?:const|var|let)\s+routeTree\b/.test(f.content),
  );
}

function restoreTanstackBootstrap(files: ProjectFile[]): TanstackFallbackResult | null {
  if (!hasGeneratedRouteTree(files)) return null;
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

export function fixTanstackRouterWithoutProvider(files: ProjectFile[]): TanstackFallbackResult {
  const notes: string[] = [];
  if (!importsTanstackRouter(files) || routerMounted(files)) return { files, notes };

  // A generated route tree means this is a real file-based TanStack app whose
  // entry point was lost or replaced. Restore the real provider so route
  // loaders, params, nested layouts, and head metadata continue to work.
  const restored = restoreTanstackBootstrap(files);
  if (restored) return restored;

  const rewritten: string[] = [];
  const out = files.map((f) => {
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

  if (rewritten.length === 0) return { files, notes };

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
  return (options: any) => ({ ...options, path: _path });
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
