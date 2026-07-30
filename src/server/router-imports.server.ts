/**
 * Deterministic repair for react-router APIs used without an import.
 *
 * Failure mode seen in production: the generated app crashes at runtime with
 * `Can't find variable: createBrowserRouter` because the model wrote
 * `createBrowserRouter([...])` in `src/main.tsx` but only imported
 * `RouterProvider` (or nothing at all). Nothing in the type-free build
 * catches it — it only explodes in the browser.
 *
 * This pass scans every TS/JS file for known react-router-dom exports used
 * as free identifiers, and augments (or adds) the `react-router-dom` import.
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
    if (missing.length === 0) return f;

    const existing = /import\s*\{([^}]*)\}\s*from\s*["']react-router-dom["'];?/;
    if (existing.test(content)) {
      content = content.replace(existing, (_m, inner: string) => {
        const names = inner
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const n of missing) if (!names.includes(n)) names.push(n);
        return `import { ${names.join(", ")} } from "react-router-dom";`;
      });
    } else {
      content = `import { ${missing.join(", ")} } from "react-router-dom";\n${content}`;
    }

    notes.push(`router-imports: added ${missing.join(", ")} to ${f.path}`);
    return { ...f, content };
  });

  return { files: out, notes };
}
