/**
 * Router facts (canonical page identity + route→file from the actual App
 * file). The former operation scheduler that lived here was a second
 * completion authority and has been removed; builds run through
 * engine/tool-loop.ts against the one readiness authority.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { PlannedPage } from "@/server/engine/plan";

/** Canonical page identity. The home page has exactly one identity no matter
 *  what file name the planner or the router chose. */
export function pageKey(route: string): string {
  const r = route.replace(/\/+$/, "") || "/";
  return `page:${r.toLowerCase()}`;
}

const HOME_NAMES = /^(home|index|landing|dashboard|overview|main)$/i;

/** Router facts from the actual App file: route → page file. Deterministic. */
export function routerPages(files: ProjectFile[]): PlannedPage[] {
  const app = files.find((f) => f.path === "src/App.tsx")?.content ?? "";
  const byIdent = new Map<string, string>();
  for (const m of app.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']@\/pages\/([A-Za-z][\w-]*)(?:\.tsx)?["']/g)) {
    byIdent.set(m[1]!, `src/pages/${m[2]!}.tsx`);
  }
  const out: PlannedPage[] = [];
  const seen = new Set<string>();
  // Explicit <Route path="x" element={<Comp …/>} />
  for (const m of app.matchAll(/<Route\b[^>]*?path=["']([^"']+)["'][^>]*?element=\{\s*<\s*([A-Za-z_$][\w$]*)/g)) {
    const file = byIdent.get(m[2]!);
    if (!file) continue;
    const key = pageKey(m[1]!);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route: m[1]!, file });
  }
  // Imported pages without a parseable <Route>: derive the route from the name.
  const routed = new Set(out.map((p) => p.file));
  for (const file of byIdent.values()) {
    if (routed.has(file)) continue;
    const name = file.split("/").pop()!.replace(/\.tsx$/, "");
    const slug = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const route = HOME_NAMES.test(name) && !seen.has(pageKey("/")) ? "/" : `/${slug}`;
    const key = pageKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route, file });
    routed.add(file);
  }
  return out;
}
