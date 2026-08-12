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
import { checkProductUsefulness } from "./product-acceptance.server";

export interface PrdFinding {
  /** Acceptance criterion id this maps to. */
  criterionId: string;
  severity: "blocking" | "warning";
  message: string;
  /** Concrete instruction for the repair pass. */
  repairHint: string;
  /** Exact file responsible when the finding comes from a concrete route. */
  path?: string;
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
  // A landing surface is whatever renders "/". Generators name it Home.tsx,
  // HomePage.tsx, index.tsx, Landing.tsx… anchoring on two exact filenames
  // made valid builds fail the gate, so match the family instead.
  landing: [
    /src\/(routes|pages)\/(index|home|landing|welcome|start)(-?page)?\.(tsx|jsx)$/i,
    /src\/(routes|pages)\/(Home|Index|Landing|Welcome)[A-Za-z]*\.(tsx|jsx)$/,
    /path=["']\/["']/,
    /<Route\s+index\b/,
  ],

  tool: [/(calculator|converter|tool|form|generator|game|playground|chat)/i],
  results: [/(result|output|summary|breakdown|timeline)/i],
  content: [/\b(about|guide|article|blog|faq|learn|resources?|content)\b/i],
  catalog: [/\b(catalog|listings?|products?|browse|shop|explore|search)\b/i],
  detail: [/(\$|:)(id|slug)|\bdetail/i],
  dashboard: [/\b(dashboard|overview|analytics)\b|admin\/index/i],
  auth: [/\b(auth|login|sign-?in|sign-?up|register)\b/i],
  // Anchored to a path segment: an unanchored /me\.tsx/ matched "Home.tsx"
  // and made every build with a home page look like it shipped an account
  // page the user never asked for.
  account: [/(^|[/\-_.])(account|profile|me)([/\-_.]|\.(tsx|jsx)$)/i],
  admin: [/(^|[/\-_.])admin([/\-_.]|\.(tsx|jsx)$)/i],
  checkout: [/\b(checkout|cart|payment|billing)\b/i],
  settings: [/(^|[/\-_.])settings([/\-_.]|\.(tsx|jsx)$)/i],
  about: [/(^|[/\-_.])about([/\-_.]|\.(tsx|jsx)$)/i],
  contact: [/(^|[/\-_.])contact([/\-_.]|\.(tsx|jsx)$)/i],
};

/** Surfaces whose presence we can assert from route files, not components. */
const ROUTE_SURFACES: PrdSurface[] = [
  "auth", "dashboard", "admin", "checkout", "account", "settings", "about", "contact", "catalog",
];

/**
 * Surfaces the product cannot work without. Everything else is informational
 * scaffolding (about/contact/content pages): worth repairing, never worth
 * throwing away twelve good files for. A build that ships the whole product
 * minus an About page is a working app, not a failed turn.
 */
const CORE_SURFACES = new Set<PrdSurface>([
  "landing", "tool", "results", "catalog", "detail", "dashboard", "auth", "checkout",
]);

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
const STATE_EVIDENCE: Record<string, RegExp> = {
  empty: /(EmptyState|NoResults|length\s*===\s*0|no (results|records|items))/i,
  loading: /(Skeleton|isLoading|isPending|loading\b)/i,
  error: /(ErrorState|isError|Retry|try again|catch\s*\()/i,
  validation: /(required|minLength|maxLength|setError|error\?\.|aria-invalid|invalid)/i,
  pending: /(disabled=\{[^}]*pending|isSubmitting|isPending|busy|Saving)/i,
  "delete-confirmation": /(AlertDialog|ConfirmDialog|confirm\(|Are you sure|delete confirmation)/i,
};

export function checkPrdStatically(
  prd: Prd,
  files: FileLike[],
  changedPaths?: string[],
): PrdCheckResult {
  const findings: PrdFinding[] = [];
  const src = files.filter((f) => f.path.startsWith("src/"));
  const changed = changedPaths ? new Set(changedPaths) : null;

  // 1. Required surfaces exist. Only core surfaces can block: a missing
  //    About page is a repair hint, not a reason to discard a working build.
  for (const surface of prd.requiredSurfaces) {
    if (!hasSurface(src, surface)) {
      findings.push({
        criterionId: `surface-${surface}`,
        severity: CORE_SURFACES.has(surface) ? "blocking" : "warning",
        message: `The PRD requires a ${surface} surface, but nothing in the emitted files provides one.`,
        repairHint: `Add the ${surface} surface described in the PRD. Wire it into the app's navigation so it is reachable.`,
      });
    }
  }

  // 2. Excluded surfaces are absent. An extra page never breaks the app, so
  //    this is advisory — it reaches the repair prompt without rolling the
  //    whole turn back.
  for (const surface of prd.excludedSurfaces) {
    const routeHit = src.find(
      (f) =>
        isRouteFile(f.path) &&
        (!changed || changed.has(f.path)) &&
        (SURFACE_EVIDENCE[surface] ?? []).some((p) => p.test(f.path)),
    );
    if (routeHit) {
      findings.push({
        criterionId: `no-${surface}`,
        severity: "warning",
        message: `A ${surface} surface was generated, but the PRD excludes it — the user never asked for it.`,
        repairHint: `Remove the ${surface} routes and any navigation entries pointing at them.`,
        path: routeHit.path,
      });
    }
  }

  // 3. Public products must not ship a sidebar app shell.
  const sidebarHit = src.find((f) => (!changed || changed.has(f.path)) && SIDEBAR_SHELL.test(f.content));
  if (
    (prd.productType === "utility" || prd.productType === "content-site" || prd.productType === "game") &&
    sidebarHit
  ) {
    findings.push({
      criterionId: "primary-action-visible",
      severity: "blocking",
      message: `This is a ${prd.productType}, but the build ships a dashboard sidebar shell.`,
      repairHint:
        "Replace the sidebar shell with a public page layout: top navigation, the product's primary tool above the fold on `/`, supporting sections below.",
      path: sidebarHit.path,
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

  // 5. Usefulness layer — can a person actually complete the workflow?
  try {
    findings.push(...checkProductUsefulness(prd, src));
  } catch {
    /* usefulness checks must never crash the gate */
  }

  // 6. Stateful products must ship their recovery and mutation states.
  if (prd.dataModel.length) {
    const allSrc = src.map((f) => f.content).join("\n");
    for (const [state, evidence] of Object.entries(STATE_EVIDENCE)) {
      if (!evidence.test(allSrc)) {
        findings.push({
          criterionId: `state-${state}`,
          severity: "blocking",
          message: `The product contract requires a ${state} state, but the emitted data surfaces do not implement one.`,
          repairHint: `Add a real ${state} state to the primary entity list/form flow without removing working behavior.`,
        });
      }
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
