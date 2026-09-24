/**
 * PLAN stage. Sizes a first build into output units that always fit the real
 * output budget. The requested pages (from the user's words) are the plan;
 * templates only add guidance. Pure — no AI call.
 */
import { buildGenerationUnits } from "@/server/requested-scope";

export interface FirstBuildPlan {
  routes: string[];
  instruction: string;
  log: string;
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
  return {
    routes,
    instruction: units.instruction ?? "",
    log:
      `[plan] maxOutput=${args.maxOutputTokens} safeBudget=${units.safeBudget} kind=${units.estimate.kind} ` +
      `estimatedOutput=${units.estimate.total} units=${units.unitCount} ` +
      `plan=${units.units.map((u, i) => `u${i + 1}[${u.routes.join(",")}]~${u.estimatedTokens}`).join(" ")}`,
  };
}
