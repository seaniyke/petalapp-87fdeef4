/**
 * Change-aware verification scope.
 *
 * Phase 3 of the builder upgrade. Visual QA is never removed — it is scoped.
 * A one-line copy edit does not need twelve screenshots across four routes;
 * a design-system or structural change does.
 *
 * Fully deterministic: file paths + the import graph, no model call.
 *
 * Tiers:
 *   full       — first build, publish, design-system/global change, or anything
 *                we cannot confidently attribute to specific routes.
 *   routes     — the change maps to specific routes (a route file, or a
 *                component those routes import). Capture only those.
 *   minimal    — the change touches no rendered surface we can identify
 *                (config, docs, server-only). Still load "/" and capture one
 *                width so a broken build cannot slip through.
 */
import { computeImpact, buildImportGraph } from "@/server/impact-graph.server";

export type VerifyScopeTier = "full" | "routes" | "minimal" | "micro";

export interface VerifyScope {
  tier: VerifyScopeTier;
  /** Routes the browser should visit; empty means "use the full plan". */
  routes: string[];
  /** Viewport widths for visual QA. */
  widths: number[];
  /** Skip the model-drafted write flows (saves an AI call + browser time). */
  skipFlows: boolean;
  /**
   * Skip screenshot capture and the vision-model design review entirely. Only
   * set for `micro`: a one-thing change to one page is checked for real
   * breakage (page errors, blank screen, broken images) and nothing else.
   */
  skipVisualScoring?: boolean;
  /** Human-readable reason, recorded on the build for debugging. */
  reason: string;
}

const ALL_WIDTHS = [390, 820, 1440];

/** A change to any of these can alter every page, so nothing is scoped away. */
const GLOBAL_RE =
  /^(src\/styles\.css|src\/index\.css|src\/main\.tsx|src\/App\.tsx|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|package\.json|index\.html|src\/routes\/__root\.tsx)$/;

/** Files that never render anything a browser can see. */
const NON_VISUAL_RE = /\.(md|json|txt|ya?ml|sql)$/i;

/** Does this file declare routes, and if so which ones? */
function routesDeclaredIn(path: string, content: string): string[] {
  const out: string[] = [];
  const re = /createFileRoute\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const p = m[1];
    if (p && !p.includes("__root")) out.push(p);
  }
  return out;
}

function normalizeRoute(p: string): string {
  let r = p.split("?")[0].split("#")[0].trim();
  if (!r.startsWith("/")) r = `/${r}`;
  if (r.length > 1) r = r.replace(/\/+$/, "");
  return r;
}

/**
 * Work out how much of the app this turn's changes can affect.
 *
 * `changedPaths` empty/unknown → full sweep. That is deliberate: we only
 * narrow when we can prove the narrowing is safe.
 */
export function computeVerifyScope(args: {
  files: Array<{ path: string; content: string }>;
  changedPaths?: string[] | null;
  knownRoutes: string[];
  /** First build of a project, or a publish — always verified in full. */
  forceFull?: boolean;
  /**
   * How big the request itself read (edit-classifier.server.ts). A one-thing
   * ask that touched one page earns the `micro` tier: load that page once and
   * look for real breakage, nothing else.
   */
  editScope?: "micro" | "targeted" | "structural" | null;
}): VerifyScope {
  const full = (reason: string): VerifyScope => ({
    tier: "full",
    routes: [],
    widths: ALL_WIDTHS,
    skipFlows: false,
    reason,
  });

  if (args.forceFull) return full("first build or publish");
  const changed = (args.changedPaths ?? []).filter(Boolean);
  if (changed.length === 0) return full("no change list available");
  if (changed.length > 12) return full("large multi-file change");
  if (changed.some((p) => GLOBAL_RE.test(p))) return full("global or design-system file changed");

  const byPath = new Map(args.files.map((f) => [f.path, f.content]));
  const routeSet = new Set<string>();
  const componentSeeds: string[] = [];
  /** Routes the change is actually on, without the home ride-along. */
  const primaryRoutes = new Set<string>();
  let sawVisual = false;

  for (const path of changed) {
    if (NON_VISUAL_RE.test(path)) continue;
    sawVisual = true;
    const content = byPath.get(path) ?? "";
    const declared = routesDeclaredIn(path, content);
    if (declared.length) {
      for (const r of declared) {
        routeSet.add(normalizeRoute(r));
        primaryRoutes.add(normalizeRoute(r));
      }
      // A brand-new route file means routing itself changed — verify home too.
      routeSet.add("/");
    } else {
      componentSeeds.push(path);
    }
  }

  // Components: any route file that (transitively, 2 hops) imports them.
  if (componentSeeds.length) {
    const impact = computeImpact(args.files, componentSeeds, { radius: 2, max: 40 });
    const graph = buildImportGraph(args.files);
    for (const dependent of impact.dependents) {
      const content = byPath.get(dependent) ?? "";
      for (const r of routesDeclaredIn(dependent, content)) {
        routeSet.add(normalizeRoute(r));
        primaryRoutes.add(normalizeRoute(r));
      }
    }
    // A shared component with no route dependents we can see is a hub risk.
    if (impact.dependents.length === 0 && graph.size > 0) {
      return full("changed component has no traceable route");
    }
  }

  const routes = [...routeSet].filter((r) => args.knownRoutes.includes(r));
  if (!sawVisual) {
    return {
      tier: "minimal",
      routes: ["/"],
      widths: [1440],
      skipFlows: true,
      reason: "no rendered files changed",
    };
  }
  if (routes.length === 0) return full("could not map the change to routes");

  // Micro: a one-thing ask that moved exactly one page-level file. Load that
  // page once and look for real breakage. No screenshots, no design grading,
  // no test sign-up, no write flows.
  const primary = [...primaryRoutes].filter((r) => args.knownRoutes.includes(r));
  if (args.editScope === "micro" && changed.length === 1 && primary.length === 1) {
    return {
      tier: "micro",
      routes: [primary[0]],
      widths: [1440],
      skipFlows: true,
      skipVisualScoring: true,
      reason: `one-thing change on ${primary[0]}`,
    };
  }

  if (routes.length >= 4) return full("change affects most of the app");

  return {
    tier: "routes",
    routes,
    widths: ALL_WIDTHS,
    // Write flows only matter when data-entry code moved.
    skipFlows: !changed.some((p) => {
      const c = byPath.get(p) ?? "";
      return /<form|onSubmit|useMutation|\.insert\(|handleSubmit/i.test(c);
    }),
    reason: `scoped to ${routes.join(", ")}`,
  };
}
