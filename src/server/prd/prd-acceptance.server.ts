/**
 * PRD — acceptance gate.
 *
 * The gate that was missing. Compile-clean, accessible, and visually tidy are
 * necessary but not sufficient: a build is only complete when the product the
 * user asked for actually exists and works.
 *
 * Two layers:
 *
 *  1. STATIC (this file, `checkPrdStatically`) — runs on the emitted files
 *     before deployment. Cheap, deterministic, and catches the exact failure
 *     that produced a dashboard for a pregnancy calculator: required surfaces
 *     missing, excluded surfaces present, formulas not implemented as real
 *     functions, results hard-coded.
 *
 *  2. RUNTIME (`prdBrowserScenarios`) — turns acceptance criteria into browser
 *     steps the verifier executes against the deployed app.
 *
 * A failure here is a build failure, and it drives ONE bounded, free repair
 * targeted at the specific criterion that failed — never a full rebuild and
 * never a second charge.
 */

import type { Prd, PrdSurface } from "./prd-types";

export interface PrdFinding {
  /** Acceptance criterion id this maps to. */
  criterionId: string;
  severity: "blocking" | "warning";
  message: string;
  /** Concrete instruction for the repair pass. */
  repairHint: string;
}

export interface PrdCheckResult {
  passed: boolean;
  findings: PrdFinding[];
}

interface FileLike {
  path: string;
  content: string;
}

/* ============================================================
 * Surface detection from emitted files
 * ============================================================ */

/** Route/file patterns that evidence each surface. */
const SURFACE_EVIDENCE: Record<PrdSurface, RegExp[]> = {
  landing: [/src\/routes\/index\.tsx$/, /src\/pages\/(Home|Index|Landing)\.tsx$/],
  tool: [/(calculator|converter|tool|form|generator|game|playground|chat)/i],
  results: [/(result|output|summary|breakdown|timeline)/i],
  content: [/(about|guide|article|blog|faq|learn|resources?|content)/i],
  catalog: [/(catalog|listings?|products?|browse|shop|explore|search)/i],
  detail: [/(\$|:)(id|slug)|detail/i],
  dashboard: [/(dashboard|overview|analytics|admin\/index)/i],
  auth: [/(auth|login|sign-?in|sign-?up|register)/i],
  account: [/(account|profile|me\.tsx)/i],
  admin: [/admin/i],
  checkout: [/(checkout|cart|payment|billing)/i],
  settings: [/settings/i],
  about: [/about/i],
  contact: [/contact/i],
};

/** Surfaces whose presence we can assert from route files, not components. */
const ROUTE_SURFACES: PrdSurface[] = [
  "auth", "dashboard", "admin", "checkout", "account", "settings", "about", "contact", "catalog",
];

function isRouteFile(path: string): boolean {
  return /^src\/(routes|pages)\//.test(path);
}

function hasSurface(files: FileLike[], surface: PrdSurface): boolean {
  const patterns = SURFACE_EVIDENCE[surface] ?? [];
  for (const f of files) {
    if (patterns.some((p) => p.test(f.path))) return true;
  }
  // Component-level surfaces (tool/results/content) may live inside the home
  // route rather than as their own file — search content too.
  if (!ROUTE_SURFACES.includes(surface)) {
    for (const f of files) {
      if (!/^src\//.test(f.path)) continue;
      if (patterns.some((p) => p.test(f.content.slice(0, 20_000)))) return true;
    }
  }
  return false;
}

/* ============================================================
 * Checks
 * ============================================================ */

const HARD_CODED_RESULT =
  /(due\s?date|result|total|payment|bmi|score)\s*[:=]\s*["'][^"']{3,}["']/i;

const SIDEBAR_SHELL = /(SidebarProvider|<Sidebar\b|AppSidebar)/;

export function checkPrdStatically(prd: Prd, files: FileLike[]): PrdCheckResult {
  const findings: PrdFinding[] = [];
  const src = files.filter((f) => f.path.startsWith("src/"));

  // 1. Required surfaces exist.
  for (const surface of prd.requiredSurfaces) {
    if (!hasSurface(src, surface)) {
      findings.push({
        criterionId: `surface-${surface}`,
        severity: "blocking",
        message: `The PRD requires a ${surface} surface, but nothing in the emitted files provides one.`,
        repairHint: `Add the ${surface} surface described in the PRD. Wire it into the app's navigation so it is reachable.`,
      });
    }
  }

  // 2. Excluded surfaces are absent.
  for (const surface of prd.excludedSurfaces) {
    const routeHit = src.some(
      (f) => isRouteFile(f.path) && (SURFACE_EVIDENCE[surface] ?? []).some((p) => p.test(f.path)),
    );
    if (routeHit) {
      findings.push({
        criterionId: `no-${surface}`,
        severity: "blocking",
        message: `A ${surface} surface was generated, but the PRD excludes it — the user never asked for it.`,
        repairHint: `Remove the ${surface} routes and any navigation entries pointing at them.`,
      });
    }
  }

  // 3. Public products must not ship a sidebar app shell.
  if (
    (prd.productType === "utility" || prd.productType === "content-site" || prd.productType === "game") &&
    src.some((f) => SIDEBAR_SHELL.test(f.content))
  ) {
    findings.push({
      criterionId: "primary-action-visible",
      severity: "blocking",
      message: `This is a ${prd.productType}, but the build ships a dashboard sidebar shell.`,
      repairHint:
        "Replace the sidebar shell with a public page layout: top navigation, the product's primary tool above the fold on `/`, supporting sections below.",
    });
  }

  // 4. Domain logic is implemented as real code, not faked.
  if (prd.formulas.length) {
    const allSrc = src.map((f) => f.content).join("\n");
    const hasLogicModule = src.some(
      (f) =>
        /^src\/lib\//.test(f.path) &&
        /export\s+(function|const)\s+\w+/.test(f.content) &&
        /(Math\.|getTime\(|Date\(|\*|\/|\+)/.test(f.content),
    );
    if (!hasLogicModule) {
      findings.push({
        criterionId: `formula-${prd.formulas[0].id}`,
        severity: "blocking",
        message: "The product's value is a calculation, but no typed calculation module was emitted under src/lib/.",
        repairHint: `Implement the PRD formulas as exported pure functions in src/lib/, and call them from the UI: ${prd.formulas
          .map((f) => f.id)
          .join(", ")}.`,
      });
    }
    if (HARD_CODED_RESULT.test(allSrc)) {
      findings.push({
        criterionId: "primary-workflow-completes",
        severity: "warning",
        message: "A result value looks hard-coded as a string literal rather than computed.",
        repairHint: "Compute every displayed result from the calculation functions; never inline an example value.",
      });
    }
  }

  return { passed: !findings.some((f) => f.severity === "blocking"), findings };
}

/* ============================================================
 * Runtime scenarios
 * ============================================================ */

export interface PrdScenario {
  criterionId: string;
  route: string;
  /** Plain-English steps handed to the browser verifier. */
  steps: string[];
  /** What must be true afterwards. */
  expect: string;
  viewport: "desktop" | "mobile";
}

export function prdBrowserScenarios(prd: Prd): PrdScenario[] {
  const out: PrdScenario[] = [];

  const workflowSteps = prd.primaryWorkflow.steps.map((s) => s.description);
  out.push({
    criterionId: "primary-workflow-completes",
    route: "/",
    steps: workflowSteps,
    expect: `The user reaches a real result for: ${prd.primaryOutcome}`,
    viewport: "desktop",
  });
  out.push({
    criterionId: "primary-action-mobile",
    route: "/",
    steps: ["Load the page at 390px wide.", "Locate the primary action.", ...workflowSteps.slice(1, 3)],
    expect: "The primary action is reachable and usable with no horizontal scrolling.",
    viewport: "mobile",
  });

  for (const f of prd.formulas) {
    if (!f.example) continue;
    out.push({
      criterionId: `formula-${f.id}`,
      route: "/",
      steps: [`Enter the worked example input: ${f.example.input}`, "Run the calculation."],
      expect: `The displayed result matches: ${f.example.expected}`,
      viewport: "desktop",
    });
  }

  return out;
}

/** Render the scenarios for the verifier's plan prompt. */
export function renderPrdScenarioBlock(prd: Prd): string {
  const scenarios = prdBrowserScenarios(prd);
  if (!scenarios.length) return "";
  const lines = ["\n\n### PRD acceptance scenarios (must all pass before this build is complete)"];
  for (const s of scenarios) {
    lines.push(`- [${s.criterionId}] on ${s.route} (${s.viewport}):`);
    for (const step of s.steps) lines.push(`    · ${step}`);
    lines.push(`    ⇒ ${s.expect}`);
  }
  return lines.join("\n");
}

/** Turn failures into a single, targeted, free repair instruction. */
export function renderPrdRepairInstruction(prd: Prd, findings: PrdFinding[]): string {
  const blocking = findings.filter((f) => f.severity === "blocking");
  if (!blocking.length) return "";
  return [
    "The build does not yet satisfy the product contract. Fix exactly these, changing nothing else:",
    ...blocking.map((f, i) => `  ${i + 1}. ${f.message}\n     → ${f.repairHint}`),
    "",
    `Reminder — the product is: ${prd.productName}, ${prd.purpose}`,
    `Primary workflow: ${prd.primaryWorkflow.name}`,
  ].join("\n");
}
