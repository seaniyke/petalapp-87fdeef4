/**
 * Phase 6 — Route-graph validator.
 *
 * Failure modes this fixes (generated apps use react-router-dom):
 *
 *   1. `<Link to="/pricing">` (or `useNavigate()("/pricing")`,
 *      `<Navigate to="/pricing" />`) targets a path that NO `<Route path="...">`
 *      defines. Build passes, runtime renders a blank screen with no
 *      indication anything is wrong.
 *   2. No `<Route path="*">` fallback. Any typo or stale link white-screens
 *      instead of degrading to a 404 page.
 *   3. Duplicate `<Route path="/">` entries (model + scaffold both claim
 *      "/"). React-Router warns and uses the LAST one, which silently
 *      throws the home page away.
 *   4. Parent `<Route element={<X/>}>` whose `X` component never renders
 *      `<Outlet />`. URL matches, child route mounts, nothing appears.
 *   5. `import { ... } from "react-router"` (v7 bare) instead of
 *      `react-router-dom` — works in some setups, breaks in ours.
 *
 * Pure ProjectFile[] → ProjectFile[]. No I/O, no model calls.
 *
 * Strategy: cheap regex scan (Babel would be safer but ~50× slower for
 * the volume we run on every generation). Findings are conservative —
 * we only repair when the fix is unambiguous.
 */

import type { ProjectFile } from "./generate.server";

const SCANNABLE = /\.(tsx|jsx)$/;
// `<Route path="/foo" ...>`  (also handles `path={"/foo"}`)
const ROUTE_PATH_RE = /<Route\b[^>]*\bpath\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g;
// `<Link to="/foo">` / `<Navigate to="/foo">` — string literal only.
const LINK_TO_RE = /<(?:Link|Navigate)\b[^>]*\bto\s*=\s*["']([^"'#?]+)/g;
// `navigate("/foo")` — `useNavigate()(...)` and aliases.
const NAVIGATE_CALL_RE = /\bnavigate\s*\(\s*["']([^"'#?]+)/g;
// `from "react-router"` (NOT -dom). Capture full import statement.
const RR_BARE_IMPORT_RE = /from\s+["']react-router["']/g;
// `<Outlet`
const OUTLET_RE = /<Outlet\b/;
// `element={<X />}` and `element={<X/>}` (no props).
const ELEMENT_COMPONENT_RE = /\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)\s*\/?\s*>?\s*\/?\s*\}/g;

export interface RouteGraphResult {
  files: ProjectFile[];
  notes: string[];
  /** Paths that were navigated to but never declared. */
  missingTargets: string[];
  /** Components used as a layout element but missing `<Outlet />`. */
  layoutsMissingOutlet: string[];
  /** Duplicate `<Route path="/">` files we dropped duplicates from. */
  duplicateRootsRepaired: string[];
  /** Files we rewrote `react-router` → `react-router-dom` in. */
  bareRouterImportsRewritten: string[];
}

function normalizeTarget(t: string): string {
  if (!t) return t;
  // Strip query/hash, drop trailing slash (except root), collapse "//".
  let s = t.split("?")[0].split("#")[0].replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** Convert a route-declaration path into a matcher regex.
 *  `/posts/:slug` → /^\/posts\/[^/]+$/
 *  `*` → matches anything.
 */
function pathToMatcher(declared: string): RegExp | "wildcard" {
  if (declared === "*" || declared === "/*") return "wildcard";
  const escaped = declared
    .split("/")
    .map((seg) => {
      if (seg === "*") return ".*";
      if (seg.startsWith(":")) return "[^/]+";
      return seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped || "/"}$`);
}

export function validateRouteGraph(files: ProjectFile[]): RouteGraphResult {
  const notes: string[] = [];
  const missingTargets = new Set<string>();
  const layoutsMissingOutlet: string[] = [];
  const duplicateRootsRepaired: string[] = [];
  const bareRouterImportsRewritten: string[] = [];

  // ----- Pass A: collect declared paths and layout-component usages.
  const declaredPaths: string[] = [];
  const layoutComponents = new Set<string>(); // components used as `element={<X/>}` for a Route that has children.

  // Track declared paths per file to detect duplicate "/".
  const rootDeclFiles: string[] = [];

  // We need a quick map of component-name → defining file so we can check
  // whether the layout renders `<Outlet />`.
  const componentDefs = new Map<string, string>(); // name → file path
  const COMPONENT_DEF_RE =
    /(?:export\s+default\s+function\s+|function\s+|const\s+|export\s+const\s+|export\s+function\s+)([A-Z][A-Za-z0-9_]*)\b/g;

  for (const f of files) {
    if (!SCANNABLE.test(f.path)) continue;
    let m: RegExpExecArray | null;

    // declared paths
    const rePath = new RegExp(ROUTE_PATH_RE.source, "g");
    let fileHasRoot = false;
    while ((m = rePath.exec(f.content))) {
      const p = normalizeTarget(m[1] ?? m[2] ?? "");
      if (!p) continue;
      declaredPaths.push(p);
      if (p === "/") fileHasRoot = true;
    }
    if (fileHasRoot) rootDeclFiles.push(f.path);

    // component definitions (Pascal-case)
    const reDef = new RegExp(COMPONENT_DEF_RE.source, "g");
    while ((m = reDef.exec(f.content))) componentDefs.set(m[1], f.path);
  }

  // layout components: any `<Route element={<X/>}>` that ALSO has nested
  // <Route> children. Cheap detection: a Route opening tag with `element=`
  // that is not self-closing.
  const ROUTE_LAYOUT_RE =
    /<Route\b[^/>]*\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)\s*\/?\s*>?\s*\/?\s*\}[^/>]*>\s*<Route\b/g;
  for (const f of files) {
    if (!SCANNABLE.test(f.path)) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(ROUTE_LAYOUT_RE.source, "g");
    while ((m = re.exec(f.content))) layoutComponents.add(m[1]);
  }

  // ----- Pass B: collect navigation targets.
  const navTargets = new Set<string>();
  for (const f of files) {
    if (!SCANNABLE.test(f.path)) continue;
    let m: RegExpExecArray | null;
    const re1 = new RegExp(LINK_TO_RE.source, "g");
    while ((m = re1.exec(f.content))) {
      const t = normalizeTarget(m[1]);
      if (t.startsWith("/")) navTargets.add(t);
    }
    const re2 = new RegExp(NAVIGATE_CALL_RE.source, "g");
    while ((m = re2.exec(f.content))) {
      const t = normalizeTarget(m[1]);
      if (t.startsWith("/")) navTargets.add(t);
    }
  }

  // ----- Pass C: compare.
  const matchers = declaredPaths.map((p) => ({ path: p, m: pathToMatcher(p) }));
  const hasWildcard = matchers.some((x) => x.m === "wildcard");
  for (const t of navTargets) {
    const hit = matchers.some((x) => x.m !== "wildcard" && (x.m as RegExp).test(t));
    if (!hit) missingTargets.add(t);
  }

  // ----- Pass D: layout components missing <Outlet />.
  for (const name of layoutComponents) {
    const file = componentDefs.get(name);
    if (!file) continue;
    const def = files.find((f) => f.path === file);
    if (!def) continue;
    if (!OUTLET_RE.test(def.content)) layoutsMissingOutlet.push(name);
  }

  // ----- Repairs.
  let out = files;

  // R1. Rewrite `react-router` → `react-router-dom`.
  out = out.map((f) => {
    if (!SCANNABLE.test(f.path) && !/\.(ts|js)$/.test(f.path)) return f;
    if (!RR_BARE_IMPORT_RE.test(f.content)) return f;
    bareRouterImportsRewritten.push(f.path);
    return { path: f.path, content: f.content.replace(/from\s+["']react-router["']/g, 'from "react-router-dom"') };
  });

  // R2. Drop duplicate `<Route path="/">` declarations — keep the FIRST
  //     occurrence project-wide. We only repair when 2+ FILES both declare
  //     "/", to avoid touching intentionally-nested duplicates.
  if (rootDeclFiles.length > 1) {
    // Keep the file that looks most like the app entry (App.tsx / main router).
    rootDeclFiles.sort((a, b) => {
      const score = (p: string) =>
        /App\.tsx$/.test(p) ? 0 : /router|routes/i.test(p) ? 1 : 2;
      return score(a) - score(b);
    });
    const keep = rootDeclFiles[0];
    for (const dropFile of rootDeclFiles.slice(1)) {
      out = out.map((f) => {
        if (f.path !== dropFile) return f;
        // Remove the FIRST `<Route path="/" ... />` (self-closing) or
        // `<Route path="/" ...></Route>` block on this file.
        const selfClose = /<Route\b[^>]*\bpath\s*=\s*["']\/["'][^>]*\/>\s*/;
        const blockOpen = /<Route\b[^>]*\bpath\s*=\s*["']\/["'][^>]*>[\s\S]*?<\/Route>\s*/;
        let next = f.content;
        if (selfClose.test(next)) next = next.replace(selfClose, "");
        else if (blockOpen.test(next)) next = next.replace(blockOpen, "");
        else return f;
        duplicateRootsRepaired.push(dropFile);
        return { path: f.path, content: next };
      });
    }
  }

  // R3. Inject a NotFound wildcard route if nav targets are missing and
  //     no `*` route exists. We add the route inside the FIRST file that
  //     declares a `<Routes>` block. We do NOT auto-create stub pages —
  //     that's a separate (Phase 8) asset-stubber concern; a real 404
  //     page is the correct fallback for unknown URLs.
  if (missingTargets.size > 0 && !hasWildcard) {
    const ROUTES_OPEN_RE = /<Routes\b[^>]*>/;
    const idx = out.findIndex((f) => SCANNABLE.test(f.path) && ROUTES_OPEN_RE.test(f.content));
    if (idx >= 0) {
      const f = out[idx];
      const NOT_FOUND_JSX = `<Route path="*" element={<div style={{ padding: "4rem 2rem", textAlign: "center", fontFamily: "system-ui" }}><h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>404</h1><p style={{ opacity: 0.7 }}>This page hasn't been built yet.</p></div>} />`;
      // Insert before `</Routes>`. If multiple, only the first.
      let content = f.content;
      const closeIdx = content.indexOf("</Routes>");
      if (closeIdx >= 0) {
        content = content.slice(0, closeIdx) + `${NOT_FOUND_JSX}\n` + content.slice(closeIdx);
        out[idx] = { path: f.path, content };
        notes.push(`route-graph: injected NotFound wildcard route in ${f.path}`);
      }
    }
  }

  // R4. Add `<Outlet />` to layout components that are missing it.
  if (layoutsMissingOutlet.length > 0) {
    for (const name of layoutsMissingOutlet) {
      const filePath = componentDefs.get(name);
      if (!filePath) continue;
      const idx = out.findIndex((f) => f.path === filePath);
      if (idx < 0) continue;
      const f = out[idx];
      // Naive but safe: append a comment + Outlet inside the FIRST return's
      // root element. We look for `return (` followed by a JSX tag and
      // insert `<Outlet />` just before its closing tag. If we can't find
      // a safe insertion point, skip — better blank than broken.
      const returnIdx = f.content.indexOf("return (");
      if (returnIdx < 0) continue;
      // Find the matching `)` for that return — naïve paren counter.
      let depth = 0;
      let endIdx = -1;
      for (let i = returnIdx + "return (".length - 1; i < f.content.length; i++) {
        const ch = f.content[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx < 0) continue;
      // Insert `<Outlet />` just before the last `</…>` close tag inside the block.
      const block = f.content.slice(returnIdx, endIdx);
      const lastClose = block.lastIndexOf("</");
      if (lastClose < 0) continue;
      // Ensure Outlet is imported.
      let content = f.content;
      if (!/from\s+["']react-router-dom["'][^;]*Outlet/.test(content) && !/Outlet[^,}\n]*}\s*from\s+["']react-router-dom["']/.test(content)) {
        // Add import or augment existing react-router-dom import.
        const rrImport = /import\s*\{([^}]*)\}\s*from\s+["']react-router-dom["']/;
        if (rrImport.test(content)) {
          content = content.replace(rrImport, (full, inner) => {
            if (/\bOutlet\b/.test(inner)) return full;
            return `import { ${inner.trim().replace(/,$/, "")}, Outlet } from "react-router-dom"`;
          });
        } else {
          content = `import { Outlet } from "react-router-dom";\n${content}`;
        }
      }
      // Re-find indices on the (possibly) updated content.
      const newReturnIdx = content.indexOf("return (", content.indexOf(`function ${name}`) >= 0 ? content.indexOf(`function ${name}`) : 0);
      if (newReturnIdx < 0) continue;
      let d = 0;
      let newEndIdx = -1;
      for (let i = newReturnIdx + "return (".length - 1; i < content.length; i++) {
        const ch = content[i];
        if (ch === "(") d++;
        else if (ch === ")") {
          d--;
          if (d === 0) {
            newEndIdx = i;
            break;
          }
        }
      }
      if (newEndIdx < 0) continue;
      const newBlock = content.slice(newReturnIdx, newEndIdx);
      const newLastClose = newBlock.lastIndexOf("</");
      if (newLastClose < 0) continue;
      const insertAt = newReturnIdx + newLastClose;
      content = content.slice(0, insertAt) + "<Outlet />\n      " + content.slice(insertAt);
      out[idx] = { path: f.path, content };
      notes.push(`route-graph: added <Outlet /> to layout component ${name} in ${filePath}`);
    }
  }

  if (bareRouterImportsRewritten.length) {
    notes.push(
      `route-graph: rewrote react-router → react-router-dom in ${bareRouterImportsRewritten.length} file(s)`,
    );
  }
  if (duplicateRootsRepaired.length) {
    notes.push(`route-graph: removed duplicate "/" route in ${duplicateRootsRepaired.length} file(s)`);
  }
  if (missingTargets.size && !hasWildcard) {
    notes.push(
      `route-graph: ${missingTargets.size} nav target(s) had no matching <Route> (${Array.from(missingTargets).slice(0, 4).join(", ")}${missingTargets.size > 4 ? "…" : ""})`,
    );
  }

  return {
    files: out,
    notes,
    missingTargets: Array.from(missingTargets),
    layoutsMissingOutlet,
    duplicateRootsRepaired,
    bareRouterImportsRewritten,
  };
}
