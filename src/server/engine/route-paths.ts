/**
 * Resolved route addresses and internal links — pure, deterministic.
 *
 * `<Route path="dashboard"><Route path="services" /></Route>` serves
 * /dashboard/services, not /services. The flat App Map records raw path
 * attributes, so nested apps looked like they served addresses they don't,
 * and dead links were invisible — hidden further by a catch-all route that
 * renders a real page. This module walks the <Route> nesting to get the real
 * addresses, collects every internal link in the app's own code, and says
 * which links reach no page (a catch-all never makes a link real).
 */
import type { ProjectFile } from "@/server/generate.server";

export type ResolvedRoute = {
  /** Full address, e.g. "/dashboard/services". */
  path: string;
  /** Components rendered from the root down to this route (layouts first). */
  chain: string[];
  /** A bare catch-all ("*" at the root) — not a real page for any link. */
  catchAll: boolean;
};

function join(parent: string, child: string): string {
  const segs = [...parent.split("/"), ...child.split("/")].filter(Boolean);
  return "/" + segs.join("/");
}

/** Read one JSX opening tag starting at `<Route`, honouring `{…}` nesting. */
function readTag(src: string, start: number): { attrs: string; selfClosing: boolean; end: number } | null {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) {
      const attrs = src.slice(start + "<Route".length, i);
      return { attrs, selfClosing: /\/\s*$/.test(attrs), end: i + 1 };
    }
  }
  return null;
}

function attrPath(attrs: string): string | null {
  const m = /\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/.exec(attrs);
  return m ? m[1]! : null;
}

function elementComponents(attrs: string): string[] {
  const i = attrs.search(/\belement\s*=\s*\{/);
  if (i < 0) return [];
  const body = attrs.slice(i);
  return [...body.matchAll(/<\s*([A-Z][\w.]*)/g)].map((m) => m[1]!);
}

/** Every addressable route in a JSX <Routes> tree, with nesting applied. */
export function resolveRouteTree(routerSrc: string): ResolvedRoute[] {
  const out: ResolvedRoute[] = [];
  const stack: Array<{ path: string; chain: string[] }> = [{ path: "/", chain: [] }];
  const token = /<Route\b|<\/Route\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(routerSrc))) {
    if (m[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const tag = readTag(routerSrc, m.index);
    if (!tag) break;
    token.lastIndex = tag.end;
    const parent = stack[stack.length - 1]!;
    const raw = attrPath(tag.attrs);
    const isIndex = /(^|\s)index(\s|=|\/|$)/.test(tag.attrs);
    const path = raw === null ? parent.path : raw.startsWith("/") ? join("/", raw) : join(parent.path, raw);
    const chain = [...parent.chain, ...elementComponents(tag.attrs)];
    if (raw !== null || isIndex) out.push({ path, chain, catchAll: path === "/*" });
    if (!tag.selfClosing) stack.push({ path, chain });
  }
  return out;
}

function segmentMatch(link: string, pattern: string): boolean {
  const l = link.split("/").filter(Boolean);
  const p = pattern.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg === "*") return l.length >= i;
    if (i >= l.length) return seg.endsWith("?");
    if (seg.startsWith(":") || seg.startsWith("$")) continue;
    if (seg.replace(/\?$/, "") !== l[i]) return false;
  }
  return l.length === p.length;
}

/** Does a link reach a real page? A bare catch-all does not count. */
export function linkResolves(link: string, routes: ResolvedRoute[]): boolean {
  const clean = link.replace(/\/+$/, "") || "/";
  return routes.some((r) => !r.catchAll && segmentMatch(clean, r.path));
}

const APP_CODE = (p: string) =>
  /\.(t|j)sx?$/.test(p) &&
  p.startsWith("src/") &&
  !p.startsWith("src/components/examples/") &&
  !p.startsWith("src/components/ui/") &&
  !p.startsWith("src/integrations/");

const LINK_PATTERNS = [
  /\b(?:to|href)\s*=\s*\{?\s*["'](\/[^"'#?\s]*)["']/g,
  /\b(?:to|href)\s*:\s*["'](\/[^"'#?\s]*)["']/g,
  /\bnavigate\(\s*["'](\/[^"'#?\s]*)["']/g,
];

/** Internal links written in the app's own code, per file. */
export function internalLinks(files: ProjectFile[]): Array<{ file: string; link: string }> {
  const out: Array<{ file: string; link: string }> = [];
  for (const f of files) {
    if (!APP_CODE(f.path)) continue;
    const seen = new Set<string>();
    for (const re of LINK_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content))) {
        const link = m[1]!;
        if (link.startsWith("//") || link.startsWith("/api/") || /\.[a-z0-9]{2,5}$/i.test(link)) continue;
        if (seen.has(link)) continue;
        seen.add(link);
        out.push({ file: f.path, link });
      }
    }
  }
  return out;
}

/** Links in the app's code that reach no page. */
export function deadInternalLinks(files: ProjectFile[], routerSrc: string): Array<{ file: string; link: string }> {
  const routes = resolveRouteTree(routerSrc);
  if (!routes.some((r) => !r.catchAll)) return [];
  return internalLinks(files).filter((l) => !linkResolves(l.link, routes));
}

/**
 * Signed-in area pages that a signed-out visitor can open. The app area is
 * /dashboard and below (public+app products); an app-only product with a
 * /login page guards everything else. A route is guarded when <RequireAuth>
 * (from "@/integrations/backend/auth") wraps it or one of its layouts.
 */
export function unguardedAppRoutes(routerSrc: string, files: ProjectFile[]): string[] {
  const routes = resolveRouteTree(routerSrc).filter((r) => !r.catchAll);
  const hasDashboard = routes.some((r) => r.path === "/dashboard" || r.path.startsWith("/dashboard/"));
  const hasLogin = routes.some((r) => r.path === "/login");
  const PUBLIC_AUTH = /^\/(login|signin|sign-in|signup|sign-up|register|auth)(\/|$)/;
  const inApp = (p: string) =>
    hasDashboard ? p === "/dashboard" || p.startsWith("/dashboard/") : hasLogin && !PUBLIC_AUTH.test(p);
  if (!hasDashboard && !hasLogin) return [];
  const byName = new Map<string, string>();
  for (const f of files) {
    const n = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = n.exec(f.content))) byName.set(m[1]!, f.content);
  }
  const guardedBy = (c: string) => c === "RequireAuth" || /<RequireAuth\b/.test(byName.get(c) ?? "");
  return [...new Set(routes.filter((r) => inApp(r.path) && !r.chain.some(guardedBy)).map((r) => r.path))];
}
