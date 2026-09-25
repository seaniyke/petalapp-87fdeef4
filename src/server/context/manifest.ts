/**
 * Authoritative Project Manifest — an INDEX of project reality.
 *
 * Derived deterministically from the current source files every turn (no AI,
 * no storage), so it can never drift from the code. Extends the App Map
 * (router/routes/pages/layouts) with components, assets, dependencies,
 * config, integrations, backend capability and build state. It never copies
 * source; it only says what exists and where.
 */
import type { ProjectFile } from "@/server/generate.server";
import { buildAppMap, type AppMap } from "@/server/engine/app-map";
import { extractDesignIntel, type DesignIntel } from "./design-intel";

export type PageType =
  | "home"
  | "auth"
  | "dashboard"
  | "pricing"
  | "contact"
  | "about"
  | "commerce"
  | "blog"
  | "settings"
  | "legal"
  | "other";

export interface ManifestPage {
  path: string;
  route: string | null;
  type: PageType;
  imports: string[];
}

export interface VerificationState {
  status: "unknown" | "passed" | "failed";
  issues: string[];
}

export interface ProjectManifest {
  identity: { name: string | null; projectId: string | null };
  framework: { runtime: string; router: AppMap["router"]; styling: string[] };
  appMap: AppMap;
  pages: ManifestPage[];
  components: string[];
  sharedComponents: string[];
  layouts: string[];
  styles: string[];
  design: DesignIntel;
  assets: string[];
  images: string[];
  dependencies: string[];
  config: string[];
  integrations: string[];
  backend: { connected: boolean; kind: "none" | "shared" | "dedicated"; usesAuth: boolean; usesDb: boolean; usesStorage: boolean };
  features: string[];
  recentChanges: string[];
  knownIssues: string[];
  verification: VerificationState;
  fileCount: number;
}

export interface ManifestInputs {
  projectId?: string | null;
  projectName?: string | null;
  backendKind?: "none" | "shared" | "dedicated";
  integrations?: string[];
  recentChanges?: string[];
  verification?: VerificationState;
}

const PAGE_TYPES: Array<[PageType, RegExp]> = [
  ["home", /(^|\/)(index|home|landing)\b/i],
  ["auth", /(login|signin|sign-in|signup|sign-up|register|auth|reset)/i],
  ["dashboard", /(dashboard|admin|overview|analytics)/i],
  ["pricing", /pricing|plans/i],
  ["contact", /contact/i],
  ["about", /about|story|team/i],
  ["commerce", /(shop|store|product|cart|checkout|order)/i],
  ["blog", /(blog|post|article|news)/i],
  ["settings", /(settings|profile|account)/i],
  ["legal", /(privacy|terms|legal)/i],
];

export function classifyPage(path: string, route: string | null): PageType {
  if (route === "/") return "home";
  const name = path.split("/").pop() ?? path;
  for (const [t, re] of PAGE_TYPES) if (re.test(name) || (route && re.test(route))) return t;
  return "other";
}

const HIDDEN = /^src\/components\/(ui|examples|blocks|fx|three|mobile)\//;

export function buildProjectManifest(files: ProjectFile[], inputs: ManifestInputs = {}): ProjectManifest {
  const appMap = buildAppMap(files);
  const paths = files.map((f) => f.path);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  const pages: ManifestPage[] = appMap.pages.map((p) => {
    const route = appMap.routes.find((r) => r.file === p)?.path ?? null;
    return { path: p, route, type: classifyPage(p, route), imports: appMap.deps[p] ?? [] };
  });

  const components = paths.filter((p) => /^src\/components\/.+\.(t|j)sx$/.test(p) && !HIDDEN.test(p)).sort();
  // Shared = imported by 2+ app files.
  const importCounts = new Map<string, number>();
  for (const deps of Object.values(appMap.deps)) for (const d of deps) importCounts.set(d, (importCounts.get(d) ?? 0) + 1);
  const sharedComponents = components.filter((c) => (importCounts.get(c) ?? 0) >= 2 || appMap.layouts.includes(c));

  const assets = paths.filter((p) => /^(public|src\/assets)\//.test(p)).sort();
  const images = assets.filter((p) => /\.(png|jpe?g|webp|gif|svg|avif)(\.asset\.json)?$/i.test(p));

  let dependencies: string[] = [];
  try {
    const pkg = JSON.parse(byPath.get("package.json") ?? "{}") as { dependencies?: Record<string, string> };
    dependencies = Object.keys(pkg.dependencies ?? {}).sort();
  } catch {
    dependencies = [];
  }

  const config = paths
    .filter((p) => /^(package\.json|vite\.config\.[tj]s|tailwind\.config\.[tj]s|tsconfig\.json|index\.html|PETAL\.md|\.petalrc)$/.test(p))
    .sort();

  const allCode = files.filter((f) => /\.(t|j)sx?$/.test(f.path) && !HIDDEN.test(f.path)).map((f) => f.content).join("\n");
  const kind = inputs.backendKind ?? (paths.some((p) => p.startsWith("src/integrations/backend/")) ? "dedicated" : "none");
  const backend = {
    connected: kind !== "none",
    kind,
    usesAuth: /\buseAuth\b|auth\.sign(In|Up)/.test(allCode),
    usesDb: /\bdb\.(list|create|update|remove)\b|supabase\.from\(/.test(allCode),
    usesStorage: /\buploadFile\b|storage\.from\(/.test(allCode),
  } as ProjectManifest["backend"];

  const features = Array.from(
    new Set([
      ...pages.map((p) => p.type).filter((t) => t !== "other"),
      ...(backend.usesAuth ? ["accounts"] : []),
      ...(backend.usesDb ? ["saved data"] : []),
      ...(/framer-motion|motion\/react/.test(allCode) ? ["animation"] : []),
      ...(/<form\b/i.test(allCode) ? ["forms"] : []),
    ]),
  );

  const styling = [
    ...(paths.some((p) => /tailwind|styles\.css|index\.css/.test(p)) || /className=/.test(allCode) ? ["tailwind"] : []),
  ];

  return {
    identity: { name: inputs.projectName ?? null, projectId: inputs.projectId ?? null },
    framework: { runtime: dependencies.includes("react") || /from ["']react["']/.test(allCode) ? "react" : "unknown", router: appMap.router, styling },
    appMap,
    pages,
    components,
    sharedComponents,
    layouts: appMap.layouts,
    styles: appMap.styles,
    design: extractDesignIntel(files),
    assets,
    images,
    dependencies,
    config,
    integrations: inputs.integrations ?? [],
    backend,
    features,
    recentChanges: (inputs.recentChanges ?? []).slice(-5),
    knownIssues: inputs.verification?.issues.slice(0, 5) ?? [],
    verification: inputs.verification ?? { status: "unknown", issues: [] },
    fileCount: files.length,
  };
}

/** Compact file tree: what exists and where — not contents. */
export function renderStructureBlock(m: ProjectManifest, maxChars = 1400): string {
  const lines = [
    "\n\nPROJECT STRUCTURE (index of the current files — read contents only from the files shown in full below):",
    `- Runtime: ${m.framework.runtime}; router: ${m.framework.router}${m.appMap.routerFile ? ` (${m.appMap.routerFile})` : ""}; ${m.fileCount} files`,
  ];
  if (m.pages.length)
    lines.push(`- Pages: ${m.pages.map((p) => `${p.path}${p.route ? ` [${p.route}]` : ""} (${p.type})`).join("; ")}`);
  if (m.layouts.length) lines.push(`- Shared layout: ${m.layouts.join(", ")}`);
  const other = m.sharedComponents.filter((c) => !m.layouts.includes(c));
  if (other.length) lines.push(`- Shared components: ${other.join(", ")}`);
  const rest = m.components.filter((c) => !m.sharedComponents.includes(c));
  if (rest.length) lines.push(`- Other components: ${rest.slice(0, 25).join(", ")}${rest.length > 25 ? ` (+${rest.length - 25})` : ""}`);
  if (m.appMap.navLinks.length) lines.push(`- Navigation links: ${m.appMap.navLinks.join(", ")}`);
  if (m.styles.length) lines.push(`- Styles: ${m.styles.join(", ")}`);
  if (m.backend.connected) lines.push(`- Backend: ${m.backend.kind}${m.backend.usesAuth ? ", accounts in use" : ""}${m.backend.usesDb ? ", data in use" : ""}`);
  if (m.integrations.length) lines.push(`- Integrations: ${m.integrations.join(", ")}`);
  if (m.verification.status === "failed" && m.knownIssues.length) lines.push(`- Known issues: ${m.knownIssues.join("; ")}`);
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 16)}\n- …(trimmed)`;
  return out;
}
