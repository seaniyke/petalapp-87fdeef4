/**
 * PLAN stage — the ONE scope contract for a first build.
 *
 *   request → plan → write
 *
 * The plan names every page and the exact file it lives in. The WRITE stage
 * executes exactly this list; no later stage may add, rename or invent pages.
 * Pure — no AI call.
 */
import { buildGenerationUnits } from "@/server/requested-scope";

export interface PlannedPage {
  route: string;
  file: string;
}

export interface FirstBuildPlan {
  routes: string[];
  pages: PlannedPage[];
  /** Addendum for the shell call: shell only, no page files. */
  instruction: string;
  log: string;
}

export function pageFileFor(route: string): string {
  const seg = route.replace(/^\//, "").split("/")[0] || "home";
  const name = seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return `src/pages/${name}.tsx`;
}

export function shellInstruction(pages: PlannedPage[]): string {
  return (
    `\n\n### Build contract (first build)\n` +
    `Planned pages — exactly these, no others:\n` +
    pages.map((p) => `- "${p.route}" → ${p.file} (default export)`).join("\n") +
    `\n\nIn THIS call write ONLY the shared shell: src/App.tsx (router registering every planned route, ` +
    `each importing its page from the file above, wrapped in the shared layout), navigation, footer, ` +
    `styles, brand mark and shared components.\n` +
    `Do NOT write any of the page files listed above — each page is written in its own dedicated call ` +
    `right after this one, and will use your shell and components.\n` +
    `Finish every file you start.\n`
  );
}

export function planFirstBuild(args: {
  prompt: string;
  plannedRoutes: string[];
  maxOutputTokens: number;
}): FirstBuildPlan {
  const units = buildGenerationUnits(args.prompt, args.plannedRoutes, {
    maxOutputTokens: args.maxOutputTokens,
  });
  const routes = Array.from(new Set([...args.plannedRoutes, ...units.allRoutes]));
  if (!routes.includes("/")) routes.unshift("/");
  const pages = routes.map((route) => ({ route, file: pageFileFor(route) }));
  return {
    routes,
    pages,
    instruction: shellInstruction(pages),
    log:
      `[plan] pages=${pages.map((p) => `${p.route}→${p.file}`).join(" ")} ` +
      `estimatedOutput=${units.estimate.total} maxOutputPerCall=${args.maxOutputTokens}`,
  };
}
