/**
 * Deterministic repair for react-router APIs used without an import.
 *
 * Failure mode seen in production: the generated app crashes at runtime with
 * `Can't find variable: createBrowserRouter` because the model wrote
 * `createBrowserRouter([...])` in `src/main.tsx` but only imported
 * `RouterProvider` (or nothing at all). Nothing in the type-free build
 * catches it — it only explodes in the browser.
 *
 * This pass scans every TS/JS file for known router exports used as free
 * identifiers, and augments (or adds) the correct package import. Generated
 * apps normally use react-router-dom, but older projects can still contain a
 * TanStack file route. Leaving its import stripped while keeping the call is
 * a production-only `Can't find variable: createFileRoute` crash.
 */

import type { ProjectFile } from "./generate.server";

/** Value exports of react-router-dom that generated apps actually use. */
const ROUTER_EXPORTS = [
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "createRoutesFromElements",
  "RouterProvider",
  "BrowserRouter",
  "HashRouter",
  "MemoryRouter",
  "Routes",
  "Route",
  "Link",
  "NavLink",
  "Navigate",
  "Outlet",
  "useNavigate",
  "useParams",
  "useLocation",
  "useSearchParams",
  "useRouteError",
  "ScrollRestoration",
] as const;

/** TanStack APIs found in legacy generated route files. Keep this deliberately
 * small: generated apps should not start using TanStack Router for new routes,
 * but old source must remain executable while users migrate it. */
const TANSTACK_ROUTER_EXPORTS = [
  "createFileRoute",
  "createRootRoute",
  "createRootRouteWithContext",
  "createLazyFileRoute",
  "getRouteApi",
] as const;

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs)$/i;

export interface RouterImportFixResult {
  files: ProjectFile[];
  notes: string[];
}

function alreadyBound(content: string, name: string): boolean {
  // Any import that mentions the name, or a local declaration of it.
  const importRx = new RegExp(`import[^;]*\\b${name}\\b[^;]*from\\s*["'][^"']+["']`);
  if (importRx.test(content)) return true;
  const declRx = new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`);
  return declRx.test(content);
}

function usedAsValue(content: string, name: string): boolean {
  // `createBrowserRouter(` / `<RouterProvider` / `<Link ` style usage.
  const call = new RegExp(`(?<![\\w.$])${name}\\s*\\(`);
  const jsx = new RegExp(`<${name}[\\s/>]`);
  return call.test(content) || jsx.test(content);
}

export function fixRouterImports(files: ProjectFile[]): RouterImportFixResult {
  const notes: string[] = [];

  const out = files.map((f) => {
    if (!CODE_EXT.test(f.path)) return f;
    let content = f.content;

    const missing = ROUTER_EXPORTS.filter(
      (name) => usedAsValue(content, name) && !alreadyBound(content, name),
    );
    const missingTanstack = TANSTACK_ROUTER_EXPORTS.filter(
      (name) => usedAsValue(content, name) && !alreadyBound(content, name),
    );
    if (missing.length === 0 && missingTanstack.length === 0) return f;

    if (missing.length > 0) {
      content = addNamedImports(content, "react-router-dom", missing);
      notes.push(`router-imports: added ${missing.join(", ")} to ${f.path}`);
    }

    if (missingTanstack.length > 0) {
      content = addNamedImports(content, "@tanstack/react-router", missingTanstack);
      notes.push(`router-imports: added ${missingTanstack.join(", ")} to ${f.path}`);
    }
    return { ...f, content };
  });

  return { files: out, notes };
}

function addNamedImports(content: string, spec: string, missing: readonly string[]): string {
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["'];?`);
  if (!existing.test(content)) {
    return `import { ${missing.join(", ")} } from "${spec}";\n${content}`;
  }
  return content.replace(existing, (_match, inner: string) => {
    const names = inner
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    for (const name of missing) if (!names.includes(name)) names.push(name);
    return `import { ${names.join(", ")} } from "${spec}";`;
  });
}
