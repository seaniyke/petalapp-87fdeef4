/**
 * Execution depth — how much verification a change needs.
 *
 *   classifier (the ONE existing classifyRequest) → INITIAL depth
 *   + deterministic impact analysis of the changed paths → FINAL depth
 *
 * Impact analysis can only RAISE the depth, never lower it. The platform floor
 * is BUILD: the hosted preview is produced by a build, so every committed
 * revision is built today. SOURCE_VALIDATION_ONLY is therefore recorded as the
 * classifier's view but never skips a build the current system requires.
 */
import type { Classification } from "./classify";

export const DEPTHS = ["NO_BUILD", "SOURCE_VALIDATION_ONLY", "BUILD", "BUILD_PLUS_BROWSER", "FULL_VERIFICATION"] as const;
export type ExecutionDepth = (typeof DEPTHS)[number];

const rank = (d: ExecutionDepth) => DEPTHS.indexOf(d);
export const maxDepth = (a: ExecutionDepth, b: ExecutionDepth): ExecutionDepth => (rank(a) >= rank(b) ? a : b);

/** Current platform minimum for any committed code change. */
export const PLATFORM_FLOOR: ExecutionDepth = "BUILD";

const TEST_ASK = /\b(test|verify|check) (it|this|that|the (app|site|flow|page))\b|\bmake sure it works\b/i;

export function initialDepth(c: Pick<Classification, "operation" | "edit" | "crossCutting">, request: string): ExecutionDepth {
  let d: ExecutionDepth;
  switch (c.operation) {
    case "first_build":
    case "architectural_change":
    case "dependency_change":
      d = "FULL_VERIFICATION";
      break;
    case "functionality_change":
    case "page_creation":
    case "repair":
      d = "BUILD_PLUS_BROWSER";
      break;
    case "content_change":
    case "styling_change":
      d = c.edit?.scope === "micro" ? "SOURCE_VALIDATION_ONLY" : "BUILD";
      break;
    default:
      d = "BUILD";
  }
  if (c.crossCutting) d = maxDepth(d, "FULL_VERIFICATION");
  if (TEST_ASK.test(request)) d = maxDepth(d, "BUILD_PLUS_BROWSER");
  return d;
}

export interface ImpactFinding {
  path: string;
  reason: string;
  requires: ExecutionDepth;
}

const RULES: Array<{ test: RegExp; reason: string; requires: ExecutionDepth }> = [
  { test: /(^|\/)(package\.json|bun\.lockb?|package-lock\.json|vite\.config\.[jt]s|tsconfig[^/]*\.json|wrangler\.(toml|jsonc?)|[^/]*\.config\.[cm]?[jt]s)$/, reason: "dependency/configuration", requires: "FULL_VERIFICATION" },
  { test: /(^|\/)(supabase\/|src\/integrations\/|src\/server\/|src\/routes\/api\/)|\.functions\.tsx?$|\.server\.tsx?$/, reason: "backend/integration", requires: "FULL_VERIFICATION" },
  { test: /(auth|login|signin|sign-in|payment|checkout|stripe|paddle|billing)/i, reason: "auth/payment-sensitive", requires: "FULL_VERIFICATION" },
  { test: /routeTree\.gen\.ts$|\.gen\.tsx?$/, reason: "generated code", requires: "FULL_VERIFICATION" },
  { test: /(^|\/)src\/(routes\/|router\.tsx|App\.tsx)/, reason: "route", requires: "BUILD_PLUS_BROWSER" },
  { test: /(^|\/)src\/(components\/|lib\/|hooks\/|utils\/)/, reason: "shared/imported module", requires: "BUILD" },
  { test: /\.(tsx?|jsx?|mjs|cjs)$/, reason: "type/runtime-sensitive code", requires: "BUILD" },
];

export function analyseImpact(changedPaths: readonly string[]): ImpactFinding[] {
  const out: ImpactFinding[] = [];
  for (const path of changedPaths) {
    const hit = RULES.find((r) => r.test.test(path));
    if (hit) out.push({ path, reason: hit.reason, requires: hit.requires });
  }
  return out;
}

/** FINAL depth: never below the initial depth, the impact findings or the platform floor. */
export function finalDepth(initial: ExecutionDepth, changedPaths: readonly string[], opts: { codeChanged: boolean }): {
  depth: ExecutionDepth;
  escalatedBy: ImpactFinding[];
} {
  let d = initial;
  const escalatedBy: ImpactFinding[] = [];
  for (const f of analyseImpact(changedPaths)) {
    if (rank(f.requires) > rank(d)) escalatedBy.push(f);
    d = maxDepth(d, f.requires);
  }
  if (opts.codeChanged) d = maxDepth(d, PLATFORM_FLOOR);
  return { depth: d, escalatedBy };
}

/** Does the depth call for browser checks after the build? */
export const needsBrowser = (d: ExecutionDepth) => rank(d) >= rank("BUILD_PLUS_BROWSER");
