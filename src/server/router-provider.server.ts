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

function isExecutableSource(path: string): boolean {
  return CODE_EXT.test(path) && !/\.(?:md|mdx)$/i.test(path);
}

export interface RouterProviderFixResult {
  files: ProjectFile[];
  notes: string[];
}

/** Module specifiers a symbol is imported from in this file. */
function importSources(content: string, name: string): string[] {
  const out: string[] = [];
  const rx = /import\s+(?:type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content))) {
    if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(m[1])) out.push(m[2]);
  }
  return out;
}

function isReactRouterSpec(spec: string): boolean {
  return spec === "react-router-dom" || spec === "react-router" || spec.startsWith("@/components/ui/router");
}

/** Preserve code shape while hiding comments and string contents from the
 * lightweight router detector. This prevents examples like
 * `// <BrowserRouter>` from being mistaken for mounted JSX. */
function maskCommentsAndStrings(content: string): string {
  let out = "";
  let state: "code" | "single" | "double" | "template" | "line" | "block" = "code";
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; out += "  "; i++; continue; }
      if (ch === "/" && next === "*") { state = "block"; out += "  "; i++; continue; }
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      out += ch;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") { state = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; out += "  "; i++; }
      else out += ch === "\n" ? "\n" : " ";
      continue;
    }
    if (escaped) { escaped = false; out += " "; continue; }
    if (ch === "\\") { escaped = true; out += " "; continue; }
    const closes =
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`");
    out += closes ? ch : ch === "\n" ? "\n" : " ";
    if (closes) state = "code";
  }
  return out;
}

function usedInFile(content: string, name: string): boolean {
  const code = maskCommentsAndStrings(content);
  return (
    new RegExp(`<${name}[\\s/>]`).test(code) ||
    new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(code)
  );
}

/**
 * A file consumes the *react-router* context when it uses a router primitive
 * that resolves to react-router-dom, the project's router re-export, or the
 * TanStack compatibility shim (which is implemented on top of react-router).
 *
 * Symbols imported from `@tanstack/react-router` are a DIFFERENT context: a
 * mounted TanStack `<RouterProvider>` does not satisfy them, and treating it
 * as one is what left apps crashing with
 * `Cannot destructure property 'basename' … as it is null`.
 */
function usesConsumer(content: string): boolean {
  return CONSUMERS.some((name) => {
    if (!usedInFile(content, name)) return false;
    const sources = importSources(content, name);
    if (sources.length === 0) {
      // No import yet — the router-imports pass defaults these to
      // react-router-dom, so treat it as a react-router consumer.
      return true;
    }
    return sources.some((s) => isReactRouterSpec(s) || s === "@/lib/router-compat");
  });
}

function hasProvider(content: string): boolean {
  return PROVIDERS.some((name) => {
    if (!usedInFile(content, name)) return false;
    const sources = importSources(content, name);
    if (sources.length > 0) {
      // Only a react-router provider mounts the context react-router
      // consumers read. TanStack providers and the inert compat-shim
      // factories must NOT suppress <BrowserRouter>.
      return sources.some(isReactRouterSpec);
    }
    // Locally declared provider component (e.g. a wrapper defined in-file).
    return new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`).test(content);
  });
}

/**
 * A provider only protects consumers rendered BELOW it. Merely finding a
 * provider in a reachable sibling/descendant module is not enough: that was
 * the root cause of persistent `basename` crashes after the earlier graph
 * reachability fix.
 *
 * Follow the component mounted by `.render(...)` (normally App) and only
 * accept a react-router provider when it is the root JSX wrapper. This is a
 * conservative dominance check: when uncertain we wrap at the entry, where
 * the provider is guaranteed to be an ancestor of every consumer.
 */
function providerDominatesRoot(entryPath: string, byPath: Map<string, ProjectFile>): boolean {
  const visited = new Set<string>();

  function inspect(path: string, jsx: string, depth: number): boolean {
    if (depth > 6 || visited.has(path)) return false;
    visited.add(path);
    const file = byPath.get(path);
    if (!file) return false;

    // A fragment has multiple sibling roots; a provider in one branch cannot
    // dominate the others. Always choose the safe entry-level wrapper.
    if (/^\s*<>/.test(jsx)) return false;

    const tags = Array.from(jsx.matchAll(/<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?=[\s/>])/g))
      .map((m) => m[1])
      .filter((name) => name !== "React.StrictMode" && name !== "StrictMode" && name !== "Fragment");
    const root = tags[0];
    if (!root) return false;

    if (PROVIDERS.includes(root as (typeof PROVIDERS)[number])) {
      return hasProvider(file.content);
    }

    const importRx = new RegExp(
      `import\\s+(?:${root}|\\{[^}]*\\b${root}\\b[^}]*\\})\\s+from\\s*["']([^"']+)["']`,
    );
    const spec = importRx.exec(file.content)?.[1];
    if (!spec) return false;
    const target = resolveImport(path, spec, byPath);
    if (!target) return false;
    const targetContent = byPath.get(target)?.content ?? "";
    const returned =
      /return\s*\(\s*([\s\S]*?)\s*\)\s*;?/.exec(targetContent)?.[1] ??
      /return\s+(<[^;]+>)\s*;?/.exec(targetContent)?.[1] ??
      /=>\s*(<[^;]+>)/.exec(targetContent)?.[1] ??
      "";
    return returned ? inspect(target, returned, depth + 1) : false;
  }

  const entry = byPath.get(entryPath);
  if (!entry) return false;
  const rendered = /\.render\(\s*([\s\S]*?)\s*\)\s*;?/.exec(entry.content)?.[1] ?? "";
  return rendered ? inspect(entryPath, rendered, 0) : false;
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

function renderArgumentBounds(content: string): { start: number; end: number } | null {
  const marker = content.search(/\.render\s*\(/);
  if (marker < 0) return null;
  const open = content.indexOf("(", marker);
  if (open < 0) return null;
  let parens = 1;
  let braces = 0;
  let brackets = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let i = open + 1; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
    else if (ch === "(") parens++;
    else if (ch === ")") {
      parens--;
      if (parens === 0 && braces === 0 && brackets === 0) return { start: open + 1, end: i };
    }
  }
  return null;
}

/** Wrap `<App />` (or whatever root element) inside createRoot().render(...). */
function wrapRootRender(content: string): string | null {
  const bounds = renderArgumentBounds(content);
  if (!bounds) return null;
  const rawInner = content.slice(bounds.start, bounds.end);
  const inner = rawInner.trim();
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
  return `${content.slice(0, bounds.start)}${wrapped}${content.slice(bounds.end)}`;
}

function wrapDefaultAppReturn(content: string): string | null {
  const declaration = /export\s+default\s+function\s+(?:App\s*)?\([^)]*\)\s*\{/.exec(content);
  if (!declaration || declaration.index === undefined) return null;
  const bodyStart = declaration.index + declaration[0].length;
  let depth = 1;
  let bodyEnd = -1;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  if (bodyEnd < 0) return null;
  const body = content.slice(bodyStart, bodyEnd);
  const returned = /return\s*\(\s*([\s\S]*?)\s*\)\s*;?/.exec(body);
  if (!returned || returned.index === undefined) return null;
  const replacement = `return (\n    <BrowserRouter>\n      ${returned[1]}\n    </BrowserRouter>\n  );`;
  const start = bodyStart + returned.index;
  const end = start + returned[0].length;
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

/** Resolve a relative/aliased import specifier to a file in the project. */
function resolveImport(fromPath: string, spec: string, byPath: Map<string, ProjectFile>): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = `src/${spec.slice(2)}`;
  } else if (spec.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1);
    const parts = spec.split("/");
    for (const p of parts) {
      if (p === "." || p === "") continue;
      if (p === "..") dir.pop();
      else dir.push(p);
    }
    base = dir.join("/");
  } else {
    return null;
  }
  const candidates = [base, `${base}.tsx`, `${base}.jsx`, `${base}.ts`, `${base}.js`, `${base}/index.tsx`, `${base}/index.jsx`];
  for (const c of candidates) if (byPath.has(c)) return c;
  return null;
}

/**
 * Files actually reachable from the app entry. A provider imported by an
 * orphaned/unused module does NOT mount the router at runtime, so provider
 * detection must be restricted to the live render graph.
 */
function reachableFrom(entry: string, byPath: Map<string, ProjectFile>): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const content = byPath.get(cur)?.content ?? "";
    const rx = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content))) {
      const next = resolveImport(cur, m[1], byPath);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

export function fixMissingRouterProvider(files: ProjectFile[]): RouterProviderFixResult {
  const notes: string[] = [];
  const code = files.filter((f) => isExecutableSource(f.path));
  if (code.length === 0) return { files, notes };

  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const entryPath =
    code.find((f) => /src\/main\.(tsx|jsx)$/i.test(f.path) && /\.render\(/.test(f.content))?.path ??
    code.find((f) => /\.render\(/.test(f.content))?.path ??
    null;
  const live = entryPath ? reachableFrom(entryPath, byPath) : null;

  const anyConsumer = code.some(
    (f) =>
      !f.path.includes("router-compat") &&
      (live ? live.has(f.path) : true) &&
      usesConsumer(f.content),
  );
  if (!anyConsumer) return { files, notes };

  // Reachability is insufficient: a provider in a Header, modal, or sibling
  // branch does not provide context to Routes/Link elsewhere. Only skip the
  // repair when the provider dominates the root render.
  if (entryPath && providerDominatesRoot(entryPath, byPath)) return { files, notes };

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
    const wrappedApp = wrapDefaultAppReturn(app.content);
    if (wrappedApp) {
      const next = ensureBrowserRouterImport(wrappedApp);
      notes.push(`router-provider: wrapped App() output in <BrowserRouter> (${app.path})`);
      return {
        files: files.map((f) => (f.path === app.path ? { ...f, content: next } : f)),
        notes,
      };
    }
  }

  return { files, notes };
}
