/**
 * Deterministic repair for react-router primitives used with NO Router
 * provider mounted anywhere in the app.
 *
 * Production failure mode:
 *   `Cannot destructure property 'basename' from null or undefined value`
 *
 * react-router v6/v7 reads `NavigationContext` inside `<Link>`, `<Routes>`,
 * `useNavigate()`, `useLocation()` etc. When nothing renders a router, that
 * context is `null` and the very first destructure blows up at runtime —
 * the build succeeds, so only the browser sees it.
 *
 * This pass runs AFTER router-imports (which guarantees the symbols are
 * imported) and injects a `<BrowserRouter>` around the root render when the
 * graph has consumers but no provider.
 */

import type { ProjectFile } from "./generate.server";

/** Anything that requires a Router ancestor at render time. */
const CONSUMERS = [
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
  "useRoutes",
] as const;

/** Anything that PROVIDES the router context. */
const PROVIDERS = [
  "BrowserRouter",
  "HashRouter",
  "MemoryRouter",
  "RouterProvider",
  "Router",
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
] as const;

const CODE_EXT = /\.(tsx|jsx)$/i;

export interface RouterProviderFixResult {
  files: ProjectFile[];
  notes: string[];
}

function usesConsumer(content: string): boolean {
  return CONSUMERS.some(
    (name) => new RegExp(`<${name}[\\s/>]`).test(content) || new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(content),
  );
}

function hasProvider(content: string): boolean {
  // Symbols coming from the TanStack compatibility shim are inert factories,
  // not real router providers — they must not suppress <BrowserRouter>.
  if (/from\s*["']@\/lib\/router-compat["']/.test(content)) return false;
  return PROVIDERS.some(
    (name) => new RegExp(`<${name}[\\s/>]`).test(content) || new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(content),
  );
}


function ensureBrowserRouterImport(content: string): string {
  if (/import[^;]*\bBrowserRouter\b[^;]*from/.test(content)) return content;

  // Prefer the project's own router re-export when it exists in the file's
  // import list; otherwise import straight from react-router-dom.
  const shim = /from\s*["']@\/components\/ui\/router["']/.test(content)
    ? "@/components/ui/router"
    : "react-router-dom";
  const escaped = shim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["'];?`);
  if (existing.test(content)) {
    return content.replace(existing, (_m, inner: string) => {
      const names = inner
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      if (!names.includes("BrowserRouter")) names.push("BrowserRouter");
      return `import { ${names.join(", ")} } from "${shim}";`;
    });
  }
  return `import { BrowserRouter } from "${shim}";\n${content}`;
}

/** Wrap `<App />` (or whatever root element) inside createRoot().render(...). */
function wrapRootRender(content: string): string | null {
  const rx = /(\.render\(\s*)([\s\S]*?)(\s*\)\s*;?)/;
  const m = content.match(rx);
  if (!m) return null;
  const inner = m[2].trim();
  if (!inner.startsWith("<")) return null;
  if (/<BrowserRouter/.test(inner)) return null;

  // Keep StrictMode outermost: insert the router just inside it when present.
  let wrapped: string;
  const strict = inner.match(/^<(React\.StrictMode|StrictMode)>([\s\S]*)<\/(React\.StrictMode|StrictMode)>$/);
  if (strict) {
    wrapped = `<${strict[1]}>\n    <BrowserRouter>\n      ${strict[2].trim()}\n    </BrowserRouter>\n  </${strict[3]}>`;
  } else {
    wrapped = `<BrowserRouter>\n    ${inner}\n  </BrowserRouter>`;
  }
  return content.replace(rx, (_all, open: string, _body: string, close: string) => `${open}${wrapped}${close}`);
}

export function fixMissingRouterProvider(files: ProjectFile[]): RouterProviderFixResult {
  const notes: string[] = [];
  const code = files.filter((f) => CODE_EXT.test(f.path));
  if (code.length === 0) return { files, notes };

  const anyConsumer = code.some((f) => usesConsumer(f.content));
  if (!anyConsumer) return { files, notes };

  const anyProvider = code.some((f) => hasProvider(f.content));
  if (anyProvider) return { files, notes };

  // Preferred injection point: the entry file that calls .render(...)
  const entry =
    code.find((f) => /src\/main\.(tsx|jsx)$/i.test(f.path) && /\.render\(/.test(f.content)) ??
    code.find((f) => /\.render\(/.test(f.content));

  if (entry) {
    const wrapped = wrapRootRender(entry.content);
    if (wrapped) {
      const next = ensureBrowserRouterImport(wrapped);
      notes.push(`router-provider: wrapped root render in <BrowserRouter> (${entry.path})`);
      return {
        files: files.map((f) => (f.path === entry.path ? { ...f, content: next } : f)),
        notes,
      };
    }
  }

  // Fallback: wrap the default-exported App component's returned JSX.
  const app = code.find((f) => /src\/App\.(tsx|jsx)$/i.test(f.path));
  if (app) {
    const rx = /return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\n\}/;
    const m = app.content.match(rx);
    if (m) {
      const next = ensureBrowserRouterImport(
        app.content.replace(rx, `return (\n    <BrowserRouter>\n      ${m[1]}\n    </BrowserRouter>\n  );\n}`),
      );
      notes.push(`router-provider: wrapped App() output in <BrowserRouter> (${app.path})`);
      return {
        files: files.map((f) => (f.path === app.path ? { ...f, content: next } : f)),
        notes,
      };
    }
  }

  return { files, notes };
}
