/**
 * W4 — Persisted architecture document.
 *
 * The blueprint (build-blueprint.server.ts) records *intent*: app type,
 * sections, palette. It does not record what the codebase actually looks
 * like right now — which routes exist, which file owns each one, which
 * components are shared, which libraries the project has already committed
 * to. Without that, every follow-up turn re-derives the architecture from a
 * truncated file list and drifts: a second Pricing page appears, a link
 * points at a route nobody declared, a project on react-hook-form suddenly
 * grows a hand-rolled form.
 *
 * This module derives a compact architecture doc deterministically from the
 * project files after each successful build, persists it next to the
 * blueprint (`project_blueprints.blueprint.architecture`, no migration
 * needed), and renders it back into the system prompt on later turns.
 *
 * Pure derivation + best-effort persistence. Nothing here may fail a build.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProjectFile } from "@/server/generate.server";

export interface RouteEntry {
  /** URL path, e.g. "/" or "/symptoms". */
  path: string;
  /** File that renders it, when we can attribute one. */
  file?: string;
  /** Component name used as the route element. */
  component?: string;
}

export interface ArchitectureDoc {
  /** Routing style detected in the codebase. */
  router: "react-router-dom" | "tanstack-router" | "single-page" | "unknown";
  /** Declared routes with their owning file. */
  routes: RouteEntry[];
  /** Paths linked to from the UI (Link/navigate), for drift detection. */
  navTargets: string[];
  /** Shared, reused components (used by 2+ modules). */
  sharedComponents: { name: string; file: string; usedBy: number }[];
  /** Layout/shell files every page depends on. */
  shell: string[];
  /** Third-party libraries the project already committed to. */
  libraries: string[];
  /** Whether the app talks to the backend, and through what. */
  data: { backend: boolean; client?: string; tables: string[] };
  /** Conventions worth not breaking (aliases, styling, state). */
  conventions: string[];
}

export interface VersionedArchitecture {
  architecture: ArchitectureDoc;
  revision: number;
  updatedAt: string;
}

const SOURCE_RE = /\.(tsx|jsx)$/;
const isAppSource = (p: string) =>
  SOURCE_RE.test(p) &&
  !p.startsWith("src/components/ui/") &&
  !p.startsWith("src/components/examples/");

// Whole `<Route ... >` opening tag; path + element are parsed out of it so a
// lazy optional group can never silently drop the element component.
const ROUTE_DECL_RE = /<Route\b[^>]*>/g;
const ROUTE_PATH_ATTR_RE = /\bpath\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/;
const ROUTE_ELEMENT_ATTR_RE = /\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)/;

const LINK_TO_RE = /<(?:Link|NavLink|Navigate)\b[^>]*\bto\s*=\s*["']([^"'#?]+)/g;
const NAVIGATE_CALL_RE = /\bnavigate\s*\(\s*["']([^"'#?]+)/g;
const IMPORT_RE = /from\s+["']([^"']+)["']/g;
const LOCAL_IMPORT_RE = /import\s+\{?\s*([A-Za-z0-9_,\s{}]+?)\s*\}?\s+from\s+["'](@\/[^"']+|\.[^"']+)["']/g;
const TABLE_RE = /\.from\(\s*["']([a-z0-9_]+)["']\s*\)/g;

function normalizePath(t: string): string {
  let s = (t || "").split("?")[0].split("#")[0].replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function componentFromPath(p: string): string | undefined {
  const m = p.match(/([A-Za-z0-9_]+)\.(tsx|jsx)$/);
  return m ? m[1] : undefined;
}

/** Derive the architecture doc from the current file set. Pure. */
export function deriveArchitectureDoc(files: ProjectFile[]): ArchitectureDoc {
  const src = files.filter((f) => SOURCE_RE.test(f.path) || /\.(ts|js|json)$/.test(f.path));
  const appSrc = files.filter((f) => isAppSource(f.path));
  const all = src.map((f) => f.content).join("\n");

  // ---- router flavour
  let router: ArchitectureDoc["router"] = "unknown";
  if (/from\s+["']react-router-dom["']/.test(all)) router = "react-router-dom";
  else if (/@tanstack\/react-router/.test(all)) router = "tanstack-router";
  else if (appSrc.length > 0) router = "single-page";

  // ---- routes
  const routes = new Map<string, RouteEntry>();
  const componentFile = new Map<string, string>();
  for (const f of appSrc) {
    const c = componentFromPath(f.path);
    if (c) componentFile.set(c, f.path);
  }
  for (const f of appSrc) {
    const re = new RegExp(ROUTE_DECL_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content))) {
      const path = normalizePath(m[1] ?? m[2] ?? "");
      if (!path) continue;
      const component = m[3];
      const owner = component ? componentFile.get(component) : undefined;
      if (!routes.has(path)) routes.set(path, { path, file: owner, component });
    }
  }
  // TanStack file routes.
  for (const f of files) {
    const m = f.path.match(/^src\/routes\/(.+)\.(tsx|jsx)$/);
    if (!m || m[1].startsWith("api/") || m[1] === "__root") continue;
    const path = normalizePath("/" + m[1].replace(/\/index$/, "").replace(/^index$/, ""));
    if (!routes.has(path)) routes.set(path, { path, file: f.path, component: componentFromPath(f.path) });
  }

  // ---- nav targets
  const navTargets = new Set<string>();
  for (const f of appSrc) {
    for (const re of [LINK_TO_RE, NAVIGATE_CALL_RE]) {
      const rx = new RegExp(re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = rx.exec(f.content))) {
        const t = normalizePath(m[1]);
        if (t.startsWith("/")) navTargets.add(t);
      }
    }
  }

  // ---- shared components (imported by 2+ modules)
  const importCounts = new Map<string, Set<string>>();
  for (const f of appSrc) {
    const rx = new RegExp(LOCAL_IMPORT_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(f.content))) {
      const spec = m[2];
      if (spec.startsWith("@/components/ui/")) continue;
      const target = spec.startsWith("@/") ? spec.replace("@/", "src/") : spec;
      const set = importCounts.get(target) ?? new Set<string>();
      set.add(f.path);
      importCounts.set(target, set);
    }
  }
  const sharedComponents = Array.from(importCounts.entries())
    .filter(([, users]) => users.size >= 2)
    .map(([target, users]) => ({
      name: componentFromPath(target + ".tsx") ?? target.split("/").pop() ?? target,
      file: target,
      usedBy: users.size,
    }))
    .sort((a, b) => b.usedBy - a.usedBy)
    .slice(0, 12);

  // ---- shell files
  const shell = files
    .map((f) => f.path)
    .filter((p) =>
      /^(src\/(App|main)\.(tsx|jsx)|index\.html|src\/routes\/__root\.(tsx|jsx))$/.test(p) ||
      /\/(Layout|RootLayout|AppShell|NavBar|Navbar|Header|Footer)\.(tsx|jsx)$/.test(p),
    )
    .slice(0, 10);

  // ---- libraries
  const libs = new Set<string>();
  for (const f of src) {
    const rx = new RegExp(IMPORT_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(f.content))) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("virtual:")) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (name === "react" || name === "react-dom") continue;
      libs.add(name);
    }
  }
  const libraries = Array.from(libs).sort().slice(0, 24);

  // ---- data layer
  const tables = new Set<string>();
  const rx = new RegExp(TABLE_RE.source, "g");
  let tm: RegExpExecArray | null;
  while ((tm = rx.exec(all))) tables.add(tm[1]);
  const backend = /@\/integrations\/supabase|createClient\(/.test(all);

  // ---- conventions
  const conventions: string[] = [];
  if (/@\//.test(all)) conventions.push('Imports use the "@/" alias for src/.');
  if (libraries.includes("tailwind-merge") || /className=/.test(all))
    conventions.push("Styling is Tailwind utility classes with semantic theme tokens (no hardcoded colors).");
  if (libraries.includes("react-hook-form")) conventions.push("Forms use react-hook-form + zod resolvers.");
  if (libraries.includes("@tanstack/react-query")) conventions.push("Server state uses @tanstack/react-query.");
  if (libraries.includes("sonner")) conventions.push("Toasts use sonner.");
  if (libraries.includes("framer-motion")) conventions.push("Animation uses framer-motion.");
  if (libraries.includes("lucide-react")) conventions.push("Icons come from lucide-react.");

  return {
    router,
    routes: Array.from(routes.values()).slice(0, 30),
    navTargets: Array.from(navTargets).slice(0, 30),
    sharedComponents,
    shell,
    libraries,
    data: { backend, client: backend ? "@/integrations/supabase/client" : undefined, tables: Array.from(tables).slice(0, 20) },
    conventions,
  };
}

/** Render the doc for the system prompt. Empty string when there's nothing useful. */
export function renderArchitectureBlock(versioned: VersionedArchitecture | null): string {
  const doc = versioned?.architecture;
  if (!doc || (doc.routes.length === 0 && doc.sharedComponents.length === 0)) return "";

  const lines: string[] = [];
  lines.push(`\n\n### Existing architecture (rev ${versioned!.revision} — this is what the code ACTUALLY contains)`);
  lines.push(`Router: ${doc.router}`);
  if (doc.routes.length) {
    lines.push("Routes already declared (reuse these files; never create a second page for an existing path):");
    for (const r of doc.routes) {
      lines.push(`  ${r.path}${r.file ? ` -> ${r.file}` : ""}${r.component ? ` (${r.component})` : ""}`);
    }
  }
  const orphanLinks = doc.navTargets.filter(
    (t) => !doc.routes.some((r) => r.path === t || r.path === "*" || /:/.test(r.path)),
  );
  if (orphanLinks.length) {
    lines.push(`Links pointing at undeclared routes (fix or declare them): ${orphanLinks.join(", ")}`);
  }
  if (doc.shell.length) lines.push(`Shell/layout files (edit, do not duplicate): ${doc.shell.join(", ")}`);
  if (doc.sharedComponents.length) {
    lines.push(
      "Shared components (import these instead of writing new near-duplicates): " +
        doc.sharedComponents.map((c) => `${c.name} (${c.file}, used by ${c.usedBy})`).join(", "),
    );
  }
  if (doc.libraries.length) lines.push(`Libraries already in use (prefer them; do not add rivals): ${doc.libraries.join(", ")}`);
  if (doc.data.backend) {
    lines.push(
      `Data: backend connected via ${doc.data.client}${doc.data.tables.length ? `; tables: ${doc.data.tables.join(", ")}` : ""}.`,
    );
  } else {
    lines.push("Data: no backend — keep state client-side unless the user asks for one.");
  }
  if (doc.conventions.length) lines.push("Conventions: " + doc.conventions.join(" "));
  lines.push(
    "Stay inside this architecture. Adding a route means adding it to the router AND linking it from navigation; renaming or removing one means updating every link listed above.",
  );
  return lines.join("\n");
}

export async function loadProjectArchitecture(
  projectId?: string | null,
): Promise<VersionedArchitecture | null> {
  if (!projectId) return null;
  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", projectId)
      .maybeSingle();
    const arch = data?.blueprint?.architecture;
    if (!arch || typeof arch !== "object" || !arch.architecture) return null;
    return arch as VersionedArchitecture;
  } catch (e) {
    console.warn("[architecture] load skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function saveProjectArchitecture(
  projectId: string | undefined | null,
  files: ProjectFile[],
): Promise<VersionedArchitecture | null> {
  let architecture: ArchitectureDoc;
  try {
    architecture = deriveArchitectureDoc(files);
  } catch (e) {
    console.warn("[architecture] derive failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
  if (!projectId) return { architecture, revision: 1, updatedAt: new Date().toISOString() };

  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", projectId)
      .maybeSingle();

    const previous: VersionedArchitecture | null = data?.blueprint?.architecture ?? null;
    const versioned: VersionedArchitecture = {
      architecture,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const blueprint = { ...(data?.blueprint ?? {}), architecture: versioned };
    await (supabaseAdmin as any)
      .from("project_blueprints")
      .upsert({ project_id: projectId, blueprint }, { onConflict: "project_id" });
    return versioned;
  } catch (e) {
    console.warn("[architecture] save skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
