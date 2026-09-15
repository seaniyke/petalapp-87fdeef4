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
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type ConsoleMessage,
} from "playwright";
import { isTransientEdgeStatus } from "./deploy-status.js";
import { Heartbeat } from "./progress.js";

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
  /**
   * Visual QA pass — capture a small set of compressed screenshots at mobile
   * and desktop widths so Petal can score them with a vision model. Separate
   * from `screenshots` (which is per-route debug output and gets stripped
   * before the callback).
   */
  visual?: {
    /** Viewport widths to capture. Defaults to [390, 1440]. */
    widths?: number[];
    /** Routes to capture. Defaults to the first two planned routes. */
    routes?: string[];
  };
}

export interface VisualShot {
  path: string;
  width: number;
  /** data:image/jpeg;base64,… */
  image: string;
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
  /** Sign-up succeeded but the backend requires email confirmation first. */
  confirmationRequired?: boolean;
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
  /** Visual QA screenshots, scored downstream by a vision model. */
  visual?: VisualShot[];
}


export const MAX_ROUTES = 12;
export const MAX_FLOWS = 4;
export const MAX_STEPS_PER_FLOW = 20;
const NAV_TIMEOUT_MS = 90_000;
const SETTLE_MS = 1_200;
const STEP_TIMEOUT_MS = 30_000;
const MAX_WAIT_MS = 8_000;
/**
 * Browser checks are never cut off for taking long — only for going silent.
 * Each route, step, and screenshot beats the heartbeat; this is the quiet
 * window after which the session is treated as hung.
 */
export const VERIFY_QUIET_MS = Number(process.env.VERIFY_QUIET_MS ?? 9 * 60 * 1000);
const ROUTE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

/** Console noise that says nothing about whether the app works. */
const IGNORED_CONSOLE = [
  /favicon/i,
  /download the react devtools/i,
  /\[vite\]/i,
  /sourcemap/i,
  /was preloaded using link preload but not used/i,
  /third-party cookie/i,
  /googletagmanager|analytics|hotjar|sentry/i,
  /track-runtime-error/i,
  /petal:runtime/i,
  /blocked by CORS policy.*buildwithpetal\.com\/api\/public\/track-runtime-error/i,
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
type DomProbeResult = {
  blank: boolean;
  errorScreen: boolean;
  problems: string[];
  textLength: number;
};

// Pass an executable function to Playwright rather than JavaScript source as a
// string. Playwright serializes and invokes functions itself, which removes the
// ambiguity that previously allowed a function value (and then `undefined`)
// to come back instead of the probe result.
function inspectDom(): DomProbeResult {
  const root = (
    document.querySelector('#root') ||
    document.querySelector('#app') ||
    document.body
  ) as HTMLElement;
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

  const sections = Array.from(
    root.querySelectorAll<HTMLElement>('section, main > div, [data-section]'),
  );
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
}

interface PageWatch {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/**
 * Production React reports crashes as "Minified React error #31" plus an
 * encoded args list. Left as-is, the repair pass sees no actionable text and
 * retries the identical build. Translate the ones we actually hit.
 */
const REACT_ERROR_TEXT: Record<string, string> = {
  "31": "Objects are not valid as a React child. A component rendered a plain object where a string/element was expected — usually a { label, href } style prop passed into a slot that renders its value directly.",
  "130": "Element type is invalid: a component rendered undefined — usually a wrong import (default vs named) or a missing export.",
  "137": "A text node cannot appear as a child of <table>/<tbody>: check whitespace between table elements.",
  "185": "Too many re-renders: a setState call runs during render — move it into an event handler or useEffect.",
  "418": "Hydration mismatch: server and client rendered different markup.",
  "425": "Hydration text mismatch: the rendered text differs between server and client.",
};

function decodeReactError(text: string): string {
  const m = /Minified React error #(\d+)/.exec(text);
  if (!m) return text;
  const explain = REACT_ERROR_TEXT[m[1]!];
  const args = [...text.matchAll(/args\[\]=([^&\s]+)/g)]
    .map((a) => {
      try {
        return decodeURIComponent(a[1]!);
      } catch {
        return a[1]!;
      }
    })
    .filter(Boolean);
  const parts = [`React error #${m[1]}`];
  if (explain) parts.push(explain);
  if (args.length > 0) parts.push(`details: ${args.join(", ")}`);
  return parts.join(" — ");
}

function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = truncate(decodeReactError(msg.text()));
    if (isNoise(text) || watch.consoleErrors.includes(text)) return;
    if (watch.consoleErrors.length < 12) watch.consoleErrors.push(text);
  });

  page.on("pageerror", (err) => {
    const text = truncate(decodeReactError(err.message));
    if (watch.pageErrors.includes(text)) return;
    if (watch.pageErrors.length < 12) watch.pageErrors.push(text);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    // Favicons and analytics beacons are not product defects.
    if (/favicon|analytics|gtag|hotjar|sentry|track-runtime-error|\.map$/i.test(url)) return;
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

/** Visual QA caps — the callback body is signed and parsed whole. */
const VISUAL_MAX_SHOTS = 12;
const VISUAL_MAX_BYTES = 2_600_000;
/** Phone, tablet, desktop. A design is only verified when all three are seen. */
const VISUAL_DEFAULT_WIDTHS = [390, 820, 1440];
const VISUAL_MAX_ROUTES = 4;

/**
 * Capture compressed screenshots at phone, tablet and desktop widths.
 * These are scored by a vision model on the Petal side against the frontend
 * craft rules; any defects it finds join the repair loop.
 *
 * When sign-in succeeded, the captured session is reused so gated screens
 * (dashboards, settings, account) are reviewed too instead of only ever
 * showing the login form.
 */
async function captureVisual(
  browser: Browser,
  plan: VerifyPlan,
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
): Promise<VisualShot[]> {
  const widths = (plan.visual?.widths?.length ? plan.visual.widths : VISUAL_DEFAULT_WIDTHS)
    .filter((w) => Number.isFinite(w) && w >= 320 && w <= 2000)
    .slice(0, 3);
  const routes = (
    plan.visual?.routes?.length ? plan.visual.routes : plan.routes.slice(0, VISUAL_MAX_ROUTES)
  )
    .filter((p) => typeof p === "string" && p.startsWith("/"))
    .slice(0, VISUAL_MAX_ROUTES);
  if (!widths.length || !routes.length) return [];

  const shots: VisualShot[] = [];
  let bytes = 0;

  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 700 ? 844 : 900 },
      deviceScaleFactor: 1,
      isMobile: width < 700,
      hasTouch: width < 700,
      ...(storageState ? { storageState } : {}),
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PetalVerifier",
    });
    context.setDefaultTimeout(STEP_TIMEOUT_MS);
    const page = await context.newPage();
    try {
      for (const path of routes) {
        if (shots.length >= VISUAL_MAX_SHOTS || bytes >= VISUAL_MAX_BYTES) break;
        try {
          await page.goto(new URL(path, plan.baseUrl).toString(), {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
          await page.waitForTimeout(SETTLE_MS);
          const buf = await page.screenshot({ type: "jpeg", quality: 45 });
          const image = `data:image/jpeg;base64,${buf.toString("base64")}`;
          if (bytes + image.length > VISUAL_MAX_BYTES) continue;
          bytes += image.length;
          shots.push({ path, width, image });
        } catch {
          /* one missing shot never blocks the rest */
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  return shots;
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
    for (let attempt = 0; attempt <= ROUTE_RETRY_DELAYS_MS.length; attempt++) {
      const res = await page.goto(joinUrl(baseUrl, path), {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      finding.httpStatus = res?.status() ?? null;
      if (!isTransientEdgeStatus(finding.httpStatus) || attempt === ROUTE_RETRY_DELAYS_MS.length) {
        break;
      }

      // A gateway response while a deployment is propagating belongs to the
      // hosting layer, not the generated app. Clear the console/network events
      // emitted by that failed navigation so a successful retry is judged on
      // its own evidence rather than being poisoned by the transient attempt.
      resetWatch(watch);
      await page.waitForTimeout(ROUTE_RETRY_DELAYS_MS[attempt]);
    }
  } catch (err) {
    finding.pageErrors.push(truncate(err instanceof Error ? err.message : String(err)));
    return finding;
  }

  // Let hydration, fonts, and first data fetches settle before measuring.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  try {
    const probe = await page.evaluate(inspectDom);
    // A probe that returns nothing is an instrumentation failure, not an app
    // defect — stay silent rather than reporting a phantom broken route.
    if (probe && typeof probe === "object") {
      finding.blank = probe.blank === true;
      finding.errorScreen = probe.errorScreen === true;
      finding.layout = Array.isArray(probe.problems) ? probe.problems.slice(0, 6) : [];
    } else {
      console.warn(`[verify] DOM probe returned no result for ${path} — skipping DOM checks`);
    }
  } catch (err) {
    // Instrumentation failure: log it, but never surface it to the user as an
    // app error. Real app errors already arrive via console/pageerror events.
    console.warn(`[verify] DOM probe failed on ${path}:`, err);
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
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="alert"], [data-sonner-toast], .text-destructive, [class*="error" i]',
        ),
      );
      const msg = nodes.map((node) => node.innerText.trim()).find(Boolean);
      return msg ? msg.slice(0, 200) : "";
    })
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
      // Email confirmation is a legitimate product choice, not a defect: the
      // account was created and the app told the user to check their inbox.
      // Treating it as a failure blocked otherwise healthy deploys.
      const body = (await page.textContent("body").catch(() => "")) ?? "";
      if (
        /confirm(ation)?\s+(link|email)|check\s+your\s+(e-?mail|inbox)|verify\s+your\s+e-?mail|we(?:'ve| have)?\s+sent\s+you\s+an?\s+e-?mail/i.test(
          body,
        )
      ) {
        finding.confirmationRequired = true;
      } else {
        finding.error =
          (await readAuthError(page)) ??
          "Submitted the sign-up and sign-in forms but never reached a signed-in state.";
      }
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

  if (report.auth?.attempted && !report.auth.signedIn && !report.auth.confirmationRequired) {
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

export async function runVerification(
  plan: VerifyPlan,
  heartbeat: Heartbeat = new Heartbeat("checking the app"),
): Promise<VerifyReport> {
  // Verification runs against the freshly built dist served on a loopback
  // port, so http://127.0.0.1:PORT is the NORMAL case. Requiring https here
  // silently skipped every browser check — no routes, no screenshots, no
  // visual QA — on real builds. Only remote URLs must be https.
  const isLoopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(plan.baseUrl);
  if (!isLoopback && !/^https:\/\//i.test(plan.baseUrl)) {
    throw new VerifyError("baseUrl must be an https URL (or a loopback address)");
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
      heartbeat.beat(`opening ${path}`);
      report.routes.push(await visitRoute(page, watch, plan.baseUrl, path, { screenshots }));
    }

    // Pass 2 — sign up and re-crawl the gated routes as a real user.
    if (plan.auth) {
      heartbeat.beat("checking sign-up and sign-in");
      report.auth = await runAuth(page, watch, plan.baseUrl, plan.auth, screenshots);
      if (report.auth.signedIn) {
        for (const path of plan.auth.protectedRoutes.slice(0, MAX_ROUTES)) {
          heartbeat.beat(`opening ${path} as a signed-in user`);
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
      heartbeat.beat(`running "${flow.name}"`);
      report.flows.push(await runFlow(page, watch, plan.baseUrl, flow, screenshots));
    }

    // Pass 4 — visual QA capture (phone, tablet, desktop). When sign-in
    // worked, the session is reused so gated screens are reviewed too.
    // Never fails the build.
    if (plan.visual) {
      try {
        heartbeat.beat("taking screenshots");
        const state = signedIn ? await context.storageState().catch(() => undefined) : undefined;
        report.visual = await captureVisual(browser, plan, state);
      } catch {
        /* visual QA is advisory */
      }
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
