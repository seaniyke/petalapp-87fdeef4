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
import { collectJsxRoutes } from "./verify-plan.server";


const SCANNABLE = /\.(tsx|jsx)$/;
const isAppSource = (path: string) =>
  SCANNABLE.test(path) && !path.startsWith("src/components/examples/");
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

/** Index of a component's declaration (function/const/class) in a module. */
function componentDefIndex(content: string, name: string): number {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`\\b(?:function|const|let|var|class)\\s+${esc}\\b`);
  const m = rx.exec(content);
  return m ? m.index : -1;
}

/**
 * Given source starting at `return (`, return the offset of the ROOT JSX
 * element's closing tag (`</div>`, `</>`), or null when the shape is not a
 * single wrapping element we can safely insert into.
 *
 * This is a small JSX-aware scanner: it skips strings, comments, and
 * `{...}` expression containers, so a `</div>` written inside a template
 * literal or a nested conditional can never be mistaken for the root's
 * closing tag.
 */
function rootCloseTagIndex(source: string): number | null {
  const open = source.indexOf("(");
  if (open < 0) return null;
  let i = open + 1;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl < 0) return null;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    break;
  }
  // Root must be a plain element. Ternaries, fragments-in-variables, early
  // returns and bare identifiers are ambiguous — skip rather than guess.
  if (source[i] !== "<") return null;

  let depth = 0;
  let braces = 0;
  let quote: string | null = null;

  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (quote) {
      if (ch === "\\") { j++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "/" && source[j + 1] === "/") {
      const nl = source.indexOf("\n", j);
      if (nl < 0) return null;
      j = nl;
      continue;
    }
    if (ch === "/" && source[j + 1] === "*") {
      const end = source.indexOf("*/", j);
      if (end < 0) return null;
      j = end + 1;
      continue;
    }
    if (ch === "{") { braces++; continue; }
    if (ch === "}") { braces--; continue; }
    // The root's closing tag is never inside an expression container.
    if (braces > 0 || ch !== "<") continue;

    if (source[j + 1] === "/") {
      const end = source.indexOf(">", j);
      if (end < 0) return null;
      depth--;
      if (depth === 0) return j;
      j = end;
      continue;
    }

    // Opening or self-closing tag: walk to its `>`, respecting attribute
    // strings and `{...}` attribute values.
    let k = j + 1;
    let attrQuote: string | null = null;
    let attrBraces = 0;
    for (; k < source.length; k++) {
      const c = source[k];
      if (attrQuote) {
        if (c === "\\") { k++; continue; }
        if (c === attrQuote) attrQuote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { attrQuote = c; continue; }
      if (c === "{") { attrBraces++; continue; }
      if (c === "}") { attrBraces--; continue; }
      if (c === ">" && attrBraces === 0) break;
    }
    if (k >= source.length) return null;
    if (source[k - 1] !== "/") depth++;
    j = k;
  }
  return null;
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
    if (!isAppSource(f.path)) continue;
    let m: RegExpExecArray | null;

    // declared paths (nested <Route> paths resolved against their parents)
    let fileHasRoot = false;
    for (const raw of collectJsxRoutes(f.content)) {
      const p = normalizeTarget(raw);
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
    // `[^<>]` rather than `[^/>]`: excluding `/` meant any layout route whose
    // own path contained a slash (`path="/"`, `path="/shop"`) was never
    // recognised as a layout, so its missing <Outlet /> went unrepaired.
    /<Route\b[^<>]*\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)\s*\/?\s*>?\s*\/?\s*\}[^<>]*>\s*<Route\b/g;
  for (const f of files) {
    if (!isAppSource(f.path)) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(ROUTE_LAYOUT_RE.source, "g");
    while ((m = re.exec(f.content))) layoutComponents.add(m[1]);
  }

  // ----- Pass B: collect navigation targets.
  const navTargets = new Set<string>();
  for (const f of files) {
    if (!isAppSource(f.path)) continue;
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
    if ((!SCANNABLE.test(f.path) && !/\.(ts|js)$/.test(f.path)) || f.path.startsWith("src/components/examples/")) return f;
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
        // `[^<>]` (not `[^>]`): an attribute like element={<Layout />} contains
        // a `/>` of its own, and the looser class matched a LAYOUT route's
        // opening tag as if it were self-closing — deleting the open tag and
        // stranding its `</Route>`.
        const selfClose = /<Route\b[^<>]*\bpath\s*=\s*["']\/["'][^<>]*\/>\s*/;
        const blockOpen = /<Route\b[^>]*\bpath\s*=\s*["']\/["'][^>]*>[\s\S]*?<\/Route>\s*/;
        let next = f.content;
        if (selfClose.test(next)) next = next.replace(selfClose, "");
        else {
          const m = next.match(blockOpen);
          // A non-greedy match stops at the FIRST `</Route>`, so a layout
          // route with children would be truncated mid-JSX and leave a
          // dangling open tag. Only remove a block that contains exactly
          // one `<Route` — otherwise skip; a duplicate route is a warning,
          // unbalanced JSX is a build failure.
          if (!m || (m[0].match(/<Route\b/g) ?? []).length !== 1) return f;
          next = next.replace(blockOpen, "");
        }

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

      // Ensure Outlet is imported first, then compute the insertion point on
      // the FINAL content so indices can never drift.
      let content = f.content;
      if (
        !/from\s+["']react-router-dom["'][^;]*Outlet/.test(content) &&
        !/Outlet[^,}\n]*}\s*from\s+["']react-router-dom["']/.test(content)
      ) {
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

      // Locate this component's own `return (` — searching from the start of
      // the file could target a different component in the same module.
      const defIdx = componentDefIndex(content, name);
      const returnIdx = content.indexOf("return (", defIdx >= 0 ? defIdx : 0);
      if (returnIdx < 0) continue;

      // Find the root element's closing tag with a real JSX scan. The old
      // `lastIndexOf("</")` heuristic happily matched a `</div>` inside a
      // string literal or a nested branch and produced unbalanced JSX — a
      // repair pass that BROKE the build it was meant to save.
      const closeOffset = rootCloseTagIndex(content.slice(returnIdx));
      if (closeOffset === null) continue;
      const insertAt = returnIdx + closeOffset;
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
