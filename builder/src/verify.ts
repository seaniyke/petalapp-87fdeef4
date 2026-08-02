/**
 * Petal Verifier — drives a real headless browser over a freshly-deployed
 * project and reports what actually happens.
 *
 * This is the layer between "the build compiled" and "the app works". Every
 * other check in the pipeline is static: esbuild, the repair passes, and the
 * critic all read source. None of them can see a blank hero, a route that
 * throws on mount, a sign-up form that never creates a session, or a Create
 * button that 500s. A browser can.
 *
 * Runs against the deployed Pages URL, so it exercises the same bundle the
 * user is about to look at — not a dev server with different semantics.
 *
 * Three escalating passes, each gated on the previous one:
 *   1. crawl   — visit every public route, collect console/page/network
 *                errors, and measure the DOM for blank or collapsed sections.
 *   2. auth    — sign up a disposable user through the app's own form, then
 *                re-crawl the routes that were previously gated.
 *   3. flows   — run declarative write flows (create a record, submit a form)
 *                as that signed-in user.
 *
 * Safety: everything runs against the *user's own* deployed app with their own
 * backend, so pass 2 and 3 write real rows. Callers must only send flows they
 * are willing to have executed, and every seeded account is tagged with the
 * PETAL_TEST_TAG below so it can be identified and cleaned up later.
 */
import { chromium, type Browser, type Page, type ConsoleMessage } from "playwright";

export class VerifyError extends Error {}

/** Every seeded artifact carries this marker so it is identifiable as ours. */
export const PETAL_TEST_TAG = "petal-verify";

export interface VerifyStep {
  action: "goto" | "click" | "fill" | "select" | "expectText" | "expectUrl" | "wait";
  /** goto */
  path?: string;
  /** click / fill / select — CSS selector, or `text=…` for Playwright text engine. */
  selector?: string;
  /** fill / select / expectText / expectUrl */
  value?: string;
  /** wait — milliseconds, capped. */
  ms?: number;
  /** Non-fatal steps let the flow continue when the element is genuinely optional. */
  optional?: boolean;
}

export interface VerifyFlow {
  name: string;
  /** Run this flow only after a successful sign-in. */
  requiresAuth?: boolean;
  steps: VerifyStep[];
}

export interface VerifyAuthPlan {
  /** Route holding the sign-up form. */
  signupPath: string;
  /** Route holding the sign-in form (often the same route, different tab). */
  loginPath: string;
  email: string;
  password: string;
  name?: string;
  /** Routes that should become reachable once signed in. */
  protectedRoutes: string[];
}

export interface VerifyPlan {
  baseUrl: string;
  routes: string[];
  auth?: VerifyAuthPlan;
  flows?: VerifyFlow[];
  /** Attach a JPEG screenshot per route. Off keeps the report small. */
  screenshots?: boolean;
}

export interface RouteFinding {
  path: string;
  httpStatus: number | null;
  /** Rendered app root was empty or near-empty after hydration. */
  blank: boolean;
  /** Route rendered a framework/error-boundary screen rather than content. */
  errorScreen: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Layout defects measured in the live DOM (the "black gap" class of bug). */
  layout: string[];
  /** Signed-in visit rather than an anonymous one. */
  authed?: boolean;
  screenshot?: string;
}

export interface FlowFinding {
  name: string;
  ok: boolean;
  failedStep?: string;
  error?: string;
  consoleErrors: string[];
  screenshot?: string;
}

export interface AuthFinding {
  attempted: boolean;
  signedUp: boolean;
  signedIn: boolean;
  error?: string;
  screenshot?: string;
}

export interface VerifyReport {
  ok: boolean;
  baseUrl: string;
  durationMs: number;
  routes: RouteFinding[];
  auth?: AuthFinding;
  flows: FlowFinding[];
  /** Ranked, human-readable defects. This is what gets fed back to the model. */
  defects: string[];
}

export const MAX_ROUTES = 12;
export const MAX_FLOWS = 4;
export const MAX_STEPS_PER_FLOW = 20;
const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1_200;
const STEP_TIMEOUT_MS = 8_000;
const MAX_WAIT_MS = 5_000;
export const VERIFY_TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 4 * 60 * 1000);

/** Console noise that says nothing about whether the app works. */
const IGNORED_CONSOLE = [
  /favicon/i,
  /download the react devtools/i,
  /\[vite\]/i,
  /sourcemap/i,
  /was preloaded using link preload but not used/i,
  /third-party cookie/i,
  /googletagmanager|analytics|hotjar|sentry/i,
  /^\s*$/,
];

function isNoise(text: string): boolean {
  return IGNORED_CONSOLE.some((re) => re.test(text));
}

function truncate(s: string, n = 300): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base + p;
}

/**
 * Measure the rendered page for the defects that repeatedly ship past static
 * checks. Runs in the page, so it sees final computed layout — not JSX.
 */
// NOTE: this is evaluated as an *expression* by page.evaluate(string), so it
// must be a self-invoking function. Returning a bare arrow function makes
// Playwright hand back `undefined` (functions aren't serializable), which used
// to surface as "DOM probe failed: TypeError: ... reading 'blank'".
const DOM_PROBE = `(() => {
  const root =
    document.querySelector('#root') ||
    document.querySelector('#app') ||
    document.body;
  const text = (root.innerText || '').trim();
  const vw = window.innerWidth;
  const problems = [];

  // A framework error boundary or a raw stack rendered as the page.
  const errorScreen = /Minified React error|Unexpected Application Error|Invariant failed|Cannot find variable|is not defined|Application error: a client-side exception/i.test(text);

  // Nothing rendered, or a spinner that never resolved.
  const blank = text.length < 40 && root.querySelectorAll('img, svg, video, canvas').length === 0;

  // Horizontal overflow — the mobile-breaks-everything bug.
  if (document.documentElement.scrollWidth > vw + 4) {
    problems.push('page scrolls horizontally (' + document.documentElement.scrollWidth + 'px wide in a ' + vw + 'px viewport)');
  }

  const sections = Array.from(root.querySelectorAll('section, main > div, [data-section]'));
  for (const el of sections.slice(0, 40)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4) continue;
    const inner = (el.innerText || '').trim();
    const hasMedia = el.querySelector('img, svg, video, canvas, iframe');
    // A tall block with no text and no media is the "black gap" defect.
    if (r.height > 160 && inner.length === 0 && !hasMedia) {
      problems.push('empty ' + r.height.toFixed(0) + 'px tall block (<' + el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? ' class="' + el.className.slice(0, 60) + '"' : '') + '>) renders nothing');
    }
  }

  // Unresolved template holes the model left behind.
  const placeholder = text.match(/\\{\\{[^}]{1,40}\\}\\}|\\blorem ipsum\\b|TODO:|PLACEHOLDER/i);
  if (placeholder) problems.push('placeholder text visible on the page: "' + placeholder[0].slice(0, 60) + '"');

  // Images that resolved to nothing.
  const brokenImgs = Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0);
  if (brokenImgs.length) {
    problems.push(brokenImgs.length + ' image(s) failed to load, e.g. ' + (brokenImgs[0].getAttribute('src') || '(no src)').slice(0, 80));
  }

  return { blank, errorScreen, problems, textLength: text.length };
}`;

interface PageWatch {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = truncate(msg.text());
    if (isNoise(text) || watch.consoleErrors.includes(text)) return;
    if (watch.consoleErrors.length < 12) watch.consoleErrors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = truncate(err.message);
    if (watch.pageErrors.includes(text)) return;
    if (watch.pageErrors.length < 12) watch.pageErrors.push(text);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    // Favicons and analytics beacons are not product defects.
    if (/favicon|analytics|gtag|hotjar|sentry|\.map$/i.test(url)) return;
    const entry = `${status} ${truncate(url, 140)}`;
    if (watch.failedRequests.includes(entry)) return;
    if (watch.failedRequests.length < 12) watch.failedRequests.push(entry);
  });
  return watch;
}

function resetWatch(watch: PageWatch) {
  watch.consoleErrors.length = 0;
  watch.pageErrors.length = 0;
  watch.failedRequests.length = 0;
}

async function shot(page: Page, enabled: boolean): Promise<string | undefined> {
  if (!enabled) return undefined;
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 55 });
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function visitRoute(
  page: Page,
  watch: PageWatch,
  baseUrl: string,
  path: string,
  opts: { screenshots: boolean; authed?: boolean },
): Promise<RouteFinding> {
  resetWatch(watch);
  const finding: RouteFinding = {
    path,
    httpStatus: null,
    blank: false,
    errorScreen: false,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    layout: [],
    ...(opts.authed ? { authed: true } : {}),
  };

  try {
    const res = await page.goto(joinUrl(baseUrl, path), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    finding.httpStatus = res?.status() ?? null;
  } catch (err) {
    finding.pageErrors.push(truncate(err instanceof Error ? err.message : String(err)));
    return finding;
  }

  // Let hydration, fonts, and first data fetches settle before measuring.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  try {
    const probe = (await page.evaluate(DOM_PROBE)) as {
      blank: boolean;
      errorScreen: boolean;
      problems: string[];
    };
    finding.blank = probe.blank;
    finding.errorScreen = probe.errorScreen;
    finding.layout = probe.problems.slice(0, 6);
  } catch (err) {
    finding.pageErrors.push(truncate(`DOM probe failed: ${String(err)}`));
  }

  finding.consoleErrors = [...watch.consoleErrors];
  finding.pageErrors.push(...watch.pageErrors);
  finding.failedRequests = [...watch.failedRequests];
  finding.screenshot = await shot(page, opts.screenshots);
  return finding;
}

/** Best-effort locator for a field, tolerant of however the app labelled it. */
async function findField(page: Page, kind: "email" | "password" | "name"): Promise<string | null> {
  const candidates: Record<typeof kind, string[]> = {
    email: [
      'input[type="email"]',
      'input[name="email" i]',
      'input[id="email" i]',
      'input[placeholder*="email" i]',
      'input[autocomplete="email"]',
    ],
    password: [
      'input[type="password"]:not([name*="confirm" i]):not([id*="confirm" i])',
      'input[name="password" i]',
      'input[placeholder*="password" i]',
    ],
    name: [
      'input[name*="name" i]:not([name*="user" i])',
      'input[id*="name" i]',
      'input[placeholder*="name" i]',
    ],
  } as const;

  for (const sel of candidates[kind]) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return sel;
  }
  return null;
}

async function clickSubmit(page: Page, intent: RegExp): Promise<boolean> {
  const byText = page.getByRole("button", { name: intent }).first();
  if ((await byText.count()) > 0 && (await byText.isVisible().catch(() => false))) {
    await byText.click({ timeout: STEP_TIMEOUT_MS });
    return true;
  }
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if ((await submit.count()) > 0 && (await submit.isVisible().catch(() => false))) {
    await submit.click({ timeout: STEP_TIMEOUT_MS });
    return true;
  }
  return false;
}

/** True once the app looks signed in: away from the auth route, or showing sign-out. */
async function looksSignedIn(page: Page, authPaths: string[]): Promise<boolean> {
  const path = new URL(page.url()).pathname.replace(/\/+$/, "") || "/";
  const stillOnAuth = authPaths.some((p) => (p.replace(/\/+$/, "") || "/") === path);
  if (!stillOnAuth) return true;
  const signOut = page.getByRole("button", { name: /sign ?out|log ?out/i }).first();
  if ((await signOut.count().catch(() => 0)) > 0) return true;
  const signOutLink = page.getByRole("link", { name: /sign ?out|log ?out|dashboard|account/i }).first();
  return (await signOutLink.count().catch(() => 0)) > 0;
}

/** Surface whatever the app is complaining about, so the model can fix the cause. */
async function readAuthError(page: Page): Promise<string | undefined> {
  const text = await page
    .evaluate(`() => {
      const nodes = Array.from(document.querySelectorAll('[role="alert"], [data-sonner-toast], .text-destructive, [class*="error" i]'));
      const msg = nodes.map((n) => (n.innerText || '').trim()).filter(Boolean)[0];
      return msg ? msg.slice(0, 200) : '';
    }`)
    .catch(() => "");
  return typeof text === "string" && text.trim() ? truncate(text) : undefined;
}

async function runAuth(
  page: Page,
  watch: PageWatch,
  baseUrl: string,
  plan: VerifyAuthPlan,
  screenshots: boolean,
): Promise<AuthFinding> {
  const finding: AuthFinding = { attempted: true, signedUp: false, signedIn: false };
  const authPaths = [plan.signupPath, plan.loginPath];

  try {
    resetWatch(watch);
    await page.goto(joinUrl(baseUrl, plan.signupPath), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(SETTLE_MS);

    // Many apps land on a sign-in tab; nudge over to the create-account side.
    const toSignup = page
      .getByRole("button", { name: /sign ?up|create account|register|get started/i })
      .first();
    const signupTab = page.getByRole("tab", { name: /sign ?up|register|create/i }).first();
    if ((await signupTab.count().catch(() => 0)) > 0) {
      await signupTab.click({ timeout: STEP_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(400);
    } else if (
      (await toSignup.count().catch(() => 0)) > 0 &&
      (await findField(page, "password")) === null
    ) {
      await toSignup.click({ timeout: STEP_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(600);
    }

    const emailSel = await findField(page, "email");
    const passSel = await findField(page, "password");
    if (!emailSel || !passSel) {
      finding.error = "Could not find an email + password field on the sign-up route.";
      finding.screenshot = await shot(page, screenshots);
      return finding;
    }

    const nameSel = await findField(page, "name");
    if (nameSel && plan.name) await page.fill(nameSel, plan.name, { timeout: STEP_TIMEOUT_MS });
    await page.fill(emailSel, plan.email, { timeout: STEP_TIMEOUT_MS });
    await page.fill(passSel, plan.password, { timeout: STEP_TIMEOUT_MS });

    // Confirm-password twins are common; fill any second password box too.
    const confirm = page
      .locator('input[type="password"][name*="confirm" i], input[type="password"][id*="confirm" i]')
      .first();
    if ((await confirm.count().catch(() => 0)) > 0) {
      await confirm.fill(plan.password, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    }

    const clicked = await clickSubmit(page, /sign ?up|create account|register|continue|get started/i);
    if (!clicked) {
      finding.error = "Sign-up form has no submit button.";
      finding.screenshot = await shot(page, screenshots);
      return finding;
    }
    await page.waitForTimeout(3_500);
    finding.signedUp = true;
    finding.signedIn = await looksSignedIn(page, authPaths);

    // Email confirmation on: sign-up cannot produce a session. Try signing in
    // instead — if that also fails, the account genuinely was not created.
    if (!finding.signedIn) {
      await page.goto(joinUrl(baseUrl, plan.loginPath), {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(SETTLE_MS);
      const e2 = await findField(page, "email");
      const p2 = await findField(page, "password");
      if (e2 && p2) {
        await page.fill(e2, plan.email, { timeout: STEP_TIMEOUT_MS });
        await page.fill(p2, plan.password, { timeout: STEP_TIMEOUT_MS });
        await clickSubmit(page, /sign ?in|log ?in|continue/i);
        await page.waitForTimeout(3_500);
        finding.signedIn = await looksSignedIn(page, authPaths);
      }
    }

    if (!finding.signedIn) {
      finding.error =
        (await readAuthError(page)) ??
        "Submitted the sign-up and sign-in forms but never reached a signed-in state.";
    }
    finding.screenshot = await shot(page, screenshots);
  } catch (err) {
    finding.error = truncate(err instanceof Error ? err.message : String(err));
    finding.screenshot = await shot(page, screenshots);
  }
  return finding;
}

async function runFlow(
  page: Page,
  watch: PageWatch,
  baseUrl: string,
  flow: VerifyFlow,
  screenshots: boolean,
): Promise<FlowFinding> {
  resetWatch(watch);
  const finding: FlowFinding = { name: flow.name, ok: true, consoleErrors: [] };

  for (const step of flow.steps.slice(0, MAX_STEPS_PER_FLOW)) {
    const label = `${step.action}${step.selector ? ` ${step.selector}` : ""}${step.path ? ` ${step.path}` : ""}`;
    try {
      switch (step.action) {
        case "goto":
          await page.goto(joinUrl(baseUrl, step.path ?? "/"), {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
          await page.waitForTimeout(SETTLE_MS);
          break;
        case "click":
          if (!step.selector) throw new Error("click step needs a selector");
          await page.locator(step.selector).first().click({ timeout: STEP_TIMEOUT_MS });
          await page.waitForTimeout(900);
          break;
        case "fill":
          if (!step.selector) throw new Error("fill step needs a selector");
          await page
            .locator(step.selector)
            .first()
            .fill(step.value ?? "", { timeout: STEP_TIMEOUT_MS });
          break;
        case "select":
          if (!step.selector) throw new Error("select step needs a selector");
          await page
            .locator(step.selector)
            .first()
            .selectOption(step.value ?? "", { timeout: STEP_TIMEOUT_MS });
          break;
        case "expectText": {
          const needle = step.value ?? "";
          await page
            .locator(`text=${needle}`)
            .first()
            .waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
          break;
        }
        case "expectUrl": {
          const needle = step.value ?? "";
          await page.waitForURL((u) => u.toString().includes(needle), {
            timeout: STEP_TIMEOUT_MS,
          });
          break;
        }
        case "wait":
          await page.waitForTimeout(Math.min(step.ms ?? 1000, MAX_WAIT_MS));
          break;
      }
    } catch (err) {
      if (step.optional) continue;
      finding.ok = false;
      finding.failedStep = label;
      finding.error = truncate(err instanceof Error ? err.message : String(err), 200);
      break;
    }
  }

  // A flow that "passed" while the console filled with errors did not pass.
  finding.consoleErrors = [...watch.consoleErrors, ...watch.pageErrors].slice(0, 8);
  if (watch.pageErrors.length > 0) {
    finding.ok = false;
    finding.error = finding.error ?? `Uncaught error during flow: ${watch.pageErrors[0]}`;
  }
  finding.screenshot = await shot(page, screenshots);
  return finding;
}

/** Turn raw findings into the ranked, plain-language list the model repairs from. */
function summarizeDefects(report: VerifyReport): string[] {
  const defects: string[] = [];

  for (const r of report.routes) {
    const where = r.authed ? `${r.path} (signed in)` : r.path;
    if (r.httpStatus !== null && r.httpStatus >= 400) {
      defects.push(`${where} returned HTTP ${r.httpStatus}.`);
    }
    if (r.errorScreen) {
      defects.push(`${where} rendered an error screen instead of the page.`);
    } else if (r.blank) {
      defects.push(`${where} rendered a blank page — nothing visible after hydration.`);
    }
    for (const e of r.pageErrors) defects.push(`${where} threw an uncaught error: ${e}`);
    for (const e of r.consoleErrors.slice(0, 3)) defects.push(`${where} console error: ${e}`);
    for (const l of r.layout) defects.push(`${where}: ${l}`);
    for (const f of r.failedRequests.slice(0, 3)) defects.push(`${where} request failed: ${f}`);
  }

  if (report.auth?.attempted && !report.auth.signedIn) {
    defects.push(
      `Sign-up/sign-in did not produce a signed-in session: ${report.auth.error ?? "unknown reason"}`,
    );
  }

  for (const f of report.flows) {
    if (f.ok) continue;
    defects.push(
      `Flow "${f.name}" failed${f.failedStep ? ` at step \`${f.failedStep}\`` : ""}: ${f.error ?? "unknown error"}`,
    );
  }

  // Same defect on every route is one defect, not twelve.
  return Array.from(new Set(defects)).slice(0, 40);
}

export async function runVerification(plan: VerifyPlan): Promise<VerifyReport> {
  if (!/^https:\/\//i.test(plan.baseUrl)) {
    throw new VerifyError("baseUrl must be an https URL");
  }
  const started = Date.now();
  const screenshots = Boolean(plan.screenshots);
  const report: VerifyReport = {
    ok: true,
    baseUrl: plan.baseUrl,
    durationMs: 0,
    routes: [],
    flows: [],
    defects: [],
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      // A stable UA keeps bot-detection on third-party embeds from firing.
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PetalVerifier",
    });
    context.setDefaultTimeout(STEP_TIMEOUT_MS);
    const page = await context.newPage();
    const watch = watchPage(page);

    // Pass 1 — anonymous crawl.
    const routes = plan.routes.length ? plan.routes.slice(0, MAX_ROUTES) : ["/"];
    for (const path of routes) {
      report.routes.push(await visitRoute(page, watch, plan.baseUrl, path, { screenshots }));
    }

    // Pass 2 — sign up and re-crawl the gated routes as a real user.
    if (plan.auth) {
      report.auth = await runAuth(page, watch, plan.baseUrl, plan.auth, screenshots);
      if (report.auth.signedIn) {
        for (const path of plan.auth.protectedRoutes.slice(0, MAX_ROUTES)) {
          report.routes.push(
            await visitRoute(page, watch, plan.baseUrl, path, { screenshots, authed: true }),
          );
        }
      }
    }

    // Pass 3 — write flows. Auth-dependent flows are skipped, not failed, when
    // sign-in never happened: the auth defect is already reported and running
    // them would produce a cascade of misleading follow-on errors.
    const signedIn = Boolean(report.auth?.signedIn);
    for (const flow of (plan.flows ?? []).slice(0, MAX_FLOWS)) {
      if (flow.requiresAuth && !signedIn) continue;
      report.flows.push(await runFlow(page, watch, plan.baseUrl, flow, screenshots));
    }

    await context.close();
  } finally {
    await browser?.close().catch(() => {});
  }

  report.defects = summarizeDefects(report);
  report.ok = report.defects.length === 0;
  report.durationMs = Date.now() - started;
  return report;
}
