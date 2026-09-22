/**
 * Test Lab planner — decides what to actually test in *this* app.
 *
 * A fixed suite is the wrong shape: a booking app and a marketplace share
 * almost no meaningful journeys. This module reads the generated project and
 * emits concrete, prioritized test cases, each expressed as a batch of
 * steerable-browser actions plus an explicit expectation.
 *
 * Priorities keep cost and time bounded, and they are a statement about what
 * "working" means:
 *   P0 — the app loads, sign-in works, the primary journey completes, the
 *        routes a user cannot avoid render. A P0 failure blocks acceptance.
 *   P1 — secondary pages, forms, mobile layout. Reported, not blocking.
 *   P2 — nice-to-have checks (accessibility snapshot, long-tail routes),
 *        dropped first when the budget is tight.
 *
 * Deterministic by construction: it reuses the existing verification planner's
 * route and auth detection, and converts the model-drafted primary flow rather
 * than asking for a second, differently-shaped answer. No model call is made
 * here, so a plan is always produced.
 */
import type { BrowseAction } from "@/server/browse-client.server";
import type { ProjectFile } from "@/server/generate.server";
import {
  collectRoutes,
  makeTestIdentity,
  type VerifyFlow,
  type VerifyPlan,
} from "@/server/verify-plan.server";

export type TestPriority = "P0" | "P1" | "P2";

export type TestCategory =
  | "load"
  | "auth"
  | "journey"
  | "navigation"
  | "responsive"
  | "accessibility";

export interface TestExpectation {
  /** Page must contain this text (case-insensitive). */
  textIncludes?: string;
  /** Final URL must contain this fragment. */
  urlIncludes?: string;
  /** Must not contain this text — used for error screens. */
  textExcludes?: string[];
  /** Uncaught runtime errors fail the case. On for every case by default. */
  noPageErrors?: boolean;
}

export interface TestCase {
  id: string;
  title: string;
  priority: TestPriority;
  category: TestCategory;
  /** Run only after the signed-in session has been established. */
  requiresAuth?: boolean;
  actions: BrowseAction[];
  expect: TestExpectation;
}

export interface TestPlan {
  projectId: string;
  cases: TestCase[];
  /** Disposable identity for auth cases; absent when the app has no auth. */
  identity?: { email: string; password: string; name: string };
  auth?: { signupPath: string; loginPath: string; protectedRoutes: string[] };
}

/** Hard caps so a sprawling app cannot turn into an unbounded test run. */
export const MAX_CASES = 24;
const MAX_ROUTE_CASES = 10;

/** Framework/error-boundary screens. Their presence is a failure, not content. */
const ERROR_SCREEN_TEXT = ["Application error", "Unhandled Runtime Error", "404: NOT_FOUND"];

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "case";

/** Convert a drafted verification flow into steerable-browser actions. */
export function flowToActions(flow: VerifyFlow): {
  actions: BrowseAction[];
  expect: TestExpectation;
} {
  const actions: BrowseAction[] = [];
  const expect: TestExpectation = { noPageErrors: true, textExcludes: ERROR_SCREEN_TEXT };

  for (const step of flow.steps) {
    switch (step.action) {
      case "goto":
        actions.push({ action: "goto", path: step.path ?? "/" });
        break;
      case "click":
        if (step.selector)
          actions.push({ action: "click", selector: step.selector, optional: step.optional });
        break;
      case "fill":
        if (step.selector)
          actions.push({
            action: "type",
            selector: step.selector,
            value: step.value ?? "",
            optional: step.optional,
          });
        break;
      case "select":
        if (step.selector)
          actions.push({
            action: "choose",
            selector: step.selector,
            value: step.value ?? "",
            optional: step.optional,
          });
        break;
      case "wait":
        actions.push({ action: "wait", ms: step.ms ?? 1_000, selector: step.selector });
        break;
      case "expectText":
        if (step.value) expect.textIncludes = step.value;
        break;
      case "expectUrl":
        if (step.value) expect.urlIncludes = step.value;
        break;
    }
  }
  // Always end by reading the page — that text is what the expectation is
  // checked against, and it doubles as evidence when the case fails.
  actions.push({ action: "text" });
  return { actions, expect };
}

function loadCase(args: {
  path: string;
  priority: TestPriority;
  requiresAuth?: boolean;
  screenshot?: number;
}): TestCase {
  const actions: BrowseAction[] = [{ action: "goto", path: args.path }, { action: "text" }];
  if (args.screenshot) actions.push({ action: "screenshot", width: args.screenshot });
  return {
    id: `load-${slug(args.path)}${args.requiresAuth ? "-authed" : ""}`,
    title: args.requiresAuth ? `${args.path} loads when signed in` : `${args.path} loads`,
    priority: args.priority,
    category: args.requiresAuth ? "auth" : "load",
    requiresAuth: args.requiresAuth,
    actions,
    expect: { noPageErrors: true, textExcludes: ERROR_SCREEN_TEXT },
  };
}

/**
 * Build the prioritized test plan for a project. Never throws — the floor is a
 * single P0 case that loads "/".
 */
export function buildTestPlan(args: {
  projectId: string;
  files: ProjectFile[];
  /** The verification plan already computed for this build, when available. */
  verify?: VerifyPlan | null;
}): TestPlan {
  let routes: string[];
  try {
    routes = args.verify?.routes?.length ? args.verify.routes : collectRoutes(args.files);
  } catch {
    routes = ["/"];
  }
  if (!routes.includes("/")) routes = ["/", ...routes];

  const auth = args.verify?.auth;
  const protectedRoutes = auth?.protectedRoutes ?? [];
  const publicRoutes = routes.filter((r) => !protectedRoutes.includes(r));

  const cases: TestCase[] = [];

  // ---- P0: the app is reachable at all -----------------------------------
  cases.push({
    ...loadCase({ path: "/", priority: "P0", screenshot: 1440 }),
    id: "app-loads",
    title: "The app opens",
    category: "load",
  });

  // ---- P0: authentication -------------------------------------------------
  if (auth) {
    cases.push({
      id: "auth-signup",
      title: "A new account can be created",
      priority: "P0",
      category: "auth",
      actions: [
        { action: "goto", path: auth.signupPath },
        { action: "a11y" },
        { action: "text" },
      ],
      expect: { noPageErrors: true, textExcludes: ERROR_SCREEN_TEXT },
    });
    for (const path of protectedRoutes.slice(0, 4)) {
      cases.push(loadCase({ path, priority: "P0", requiresAuth: true }));
    }
  }

  // ---- P0: the primary journey -------------------------------------------
  const flows = args.verify?.flows ?? [];
  flows.slice(0, 2).forEach((flow, index) => {
    const { actions, expect } = flowToActions(flow);
    cases.push({
      id: `journey-${slug(flow.name)}`,
      title: flow.name,
      // The first flow is the app's reason to exist; a second one is valuable
      // but not what "ready" hinges on.
      priority: index === 0 ? "P0" : "P1",
      category: "journey",
      requiresAuth: flow.requiresAuth,
      actions,
      expect,
    });
  });

  // ---- P0/P1: routes a user cannot avoid, then the rest --------------------
  const remaining = publicRoutes.filter((r) => r !== "/");
  remaining.slice(0, MAX_ROUTE_CASES).forEach((path, index) => {
    cases.push(loadCase({ path, priority: index < 2 ? "P0" : "P1" }));
  });

  // ---- P1: the home page on a phone ---------------------------------------
  cases.push({
    id: "responsive-home",
    title: "The home page works on a phone",
    priority: "P1",
    category: "responsive",
    actions: [
      { action: "goto", path: "/" },
      { action: "screenshot", width: 390 },
      { action: "text" },
    ],
    expect: { noPageErrors: true, textExcludes: ERROR_SCREEN_TEXT },
  });

  // ---- P2: long-tail checks ------------------------------------------------
  cases.push({
    id: "a11y-home",
    title: "The home page exposes usable controls",
    priority: "P2",
    category: "accessibility",
    actions: [{ action: "goto", path: "/" }, { action: "a11y" }],
    expect: { noPageErrors: true },
  });

  const deduped: TestCase[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    deduped.push(c);
  }

  return {
    projectId: args.projectId,
    cases: rank(deduped).slice(0, MAX_CASES),
    identity: auth
      ? { email: auth.email, password: auth.password, name: auth.name ?? "Kimble Verify" }
      : undefined,
    auth: auth
      ? {
          signupPath: auth.signupPath,
          loginPath: auth.loginPath,
          protectedRoutes: auth.protectedRoutes,
        }
      : undefined,
  };
}

const ORDER: Record<TestPriority, number> = { P0: 0, P1: 1, P2: 2 };

/** P0 first, then P1, then P2, stable within a band. */
export function rank(cases: TestCase[]): TestCase[] {
  return [...cases]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ORDER[a.c.priority] - ORDER[b.c.priority] || a.i - b.i)
    .map((x) => x.c);
}

export type TestBudget = "full" | "tight" | "minimal";

/**
 * Trim the plan to the budget. Dropped cases are *skipped*, never silently
 * treated as passing — the caller records them as such.
 */
export function selectCases(plan: TestPlan, budget: TestBudget): {
  run: TestCase[];
  skipped: TestCase[];
} {
  const keep = (c: TestCase) =>
    budget === "full" ? true : budget === "tight" ? c.priority !== "P2" : c.priority === "P0";
  const run = plan.cases.filter(keep);
  const skipped = plan.cases.filter((c) => !keep(c));
  return { run, skipped };
}

/** Identity used for auth cases when the verification plan did not supply one. */
export function planIdentity(projectId: string) {
  return makeTestIdentity(projectId);
}
