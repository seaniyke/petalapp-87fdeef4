/**
 * Petal Steerable Browser — a controllable Chromium session Petal can drive
 * step by step against a running app.
 *
 * `verify.ts` runs a *fixed* script (crawl → auth → flows) and reports at the
 * end. That is the right shape for an automatic post-build gate, but it cannot
 * answer "what happens if I click this and then look at the network tab?".
 * The Test Lab needs exactly that: an agent that decides the next action from
 * what it just saw.
 *
 * Shape: one HTTP request carries an ordered batch of actions, executed in a
 * single browser context, and returns the result of every step plus the
 * session-wide evidence (console errors, page errors, failed requests, final
 * URL). Batching keeps the service stateless — no session to leak, nothing
 * pinned to one Railway replica — while still letting the agent interleave
 * "act" and "observe" because it can send another batch informed by the last.
 *
 * Liveness: like every other long-running surface here, the session is never
 * cut for taking long, only for going silent. Each step beats the heartbeat.
 *
 * Safety: navigation is confined to the base URL's origin, so a hostile page
 * cannot steer the session onto an unrelated host.
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";
import { Heartbeat } from "./progress.js";

export class BrowseError extends Error {}

export const MAX_ACTIONS = 40;
export const MAX_SCREENSHOTS = 8;
/** Quiet window for the whole session — silence, not duration, ends a run. */
export const BROWSE_QUIET_MS = Number(process.env.BROWSE_QUIET_MS ?? 3 * 60 * 1000);

const NAV_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 15_000;
const MAX_WAIT_MS = 10_000;
const SETTLE_MS = 700;
const MAX_TEXT_CHARS = 6_000;
const MAX_HTML_CHARS = 12_000;
const MAX_A11Y_CHARS = 8_000;
const MAX_LOG_ENTRIES = 40;

export type BrowseAction =
  | { action: "goto"; path?: string }
  | { action: "click"; selector: string; optional?: boolean }
  | { action: "type"; selector: string; value: string; optional?: boolean }
  | { action: "choose"; selector: string; value: string; optional?: boolean }
  | { action: "press"; key: string }
  | { action: "scroll"; to?: "top" | "bottom"; px?: number }
  | { action: "wait"; ms?: number; selector?: string; optional?: boolean }
  | { action: "text"; selector?: string }
  | { action: "html"; selector?: string }
  | { action: "a11y" }
  | { action: "screenshot"; width?: number; fullPage?: boolean };

export interface BrowseStepResult {
  action: string;
  ok: boolean;
  /** Present on observation steps: text / html / a11y payload. */
  data?: string;
  /** data:image/jpeg;base64,… for screenshot steps. */
  image?: string;
  width?: number;
  url?: string;
  error?: string;
  durationMs: number;
}

export interface BrowseReport {
  ok: boolean;
  baseUrl: string;
  finalUrl: string;
  durationMs: number;
  steps: BrowseStepResult[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

export interface BrowsePlan {
  baseUrl: string;
  actions: BrowseAction[];
  /** Viewport for the session. Defaults to a desktop width. */
  viewport?: { width: number; height: number };
  /** Extra locale/timezone realism is not worth the flakiness; kept minimal. */
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
}

/** Confine navigation to the app under test. */
function resolveUrl(baseUrl: string, path: string | undefined): string {
  const base = new URL(baseUrl);
  const target = new URL(path && path.length ? path : "/", base);
  if (target.origin !== base.origin) {
    throw new BrowseError(`Navigation outside the app under test is not allowed: ${target.origin}`);
  }
  return target.toString();
}

async function runAction(
  page: Page,
  baseUrl: string,
  step: BrowseAction,
  shotsTaken: { count: number },
): Promise<Omit<BrowseStepResult, "action" | "durationMs">> {
  switch (step.action) {
    case "goto": {
      const url = resolveUrl(baseUrl, step.path);
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(SETTLE_MS);
      return {
        ok: true,
        url: page.url(),
        data: `status ${res?.status() ?? "unknown"}`,
      };
    }
    case "click": {
      await page.locator(step.selector).first().click({ timeout: STEP_TIMEOUT_MS });
      await page.waitForTimeout(SETTLE_MS);
      return { ok: true, url: page.url() };
    }
    case "type": {
      await page.locator(step.selector).first().fill(step.value, { timeout: STEP_TIMEOUT_MS });
      return { ok: true };
    }
    case "choose": {
      await page
        .locator(step.selector)
        .first()
        .selectOption(step.value, { timeout: STEP_TIMEOUT_MS });
      return { ok: true };
    }
    case "press": {
      await page.keyboard.press(step.key);
      await page.waitForTimeout(SETTLE_MS);
      return { ok: true, url: page.url() };
    }
    case "scroll": {
      const px = step.px;
      await page.evaluate(
        ({ to, amount }) => {
          if (to === "top") window.scrollTo(0, 0);
          else if (to === "bottom") window.scrollTo(0, document.body.scrollHeight);
          else window.scrollBy(0, amount ?? 600);
        },
        { to: step.to, amount: px },
      );
      await page.waitForTimeout(300);
      return { ok: true };
    }
    case "wait": {
      if (step.selector) {
        await page
          .locator(step.selector)
          .first()
          .waitFor({ state: "visible", timeout: Math.min(step.ms ?? STEP_TIMEOUT_MS, MAX_WAIT_MS) });
        return { ok: true };
      }
      await page.waitForTimeout(Math.min(step.ms ?? 1_000, MAX_WAIT_MS));
      return { ok: true };
    }
    case "text": {
      const target = step.selector ? page.locator(step.selector).first() : page.locator("body");
      const text = (await target.innerText({ timeout: STEP_TIMEOUT_MS }).catch(() => "")) || "";
      return { ok: true, data: clip(text.replace(/\n{3,}/g, "\n\n").trim(), MAX_TEXT_CHARS) };
    }
    case "html": {
      const target = step.selector ? page.locator(step.selector).first() : page.locator("body");
      const html = (await target.innerHTML({ timeout: STEP_TIMEOUT_MS }).catch(() => "")) || "";
      return { ok: true, data: clip(html, MAX_HTML_CHARS) };
    }
    case "a11y": {
      // Playwright's YAML aria snapshot — roles + names, no styling noise. It
      // is the cheapest faithful description of "what a user can act on".
      const snapshot = await page.locator("body").ariaSnapshot({ timeout: STEP_TIMEOUT_MS });
      return { ok: true, data: clip(snapshot ?? "", MAX_A11Y_CHARS) };
    }
    case "screenshot": {
      if (shotsTaken.count >= MAX_SCREENSHOTS) {
        throw new BrowseError(`Screenshot budget exhausted (${MAX_SCREENSHOTS} per session)`);
      }
      const width = step.width ?? page.viewportSize()?.width ?? 1440;
      if (width !== page.viewportSize()?.width) {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
        await page.waitForTimeout(400);
      }
      const buf = await page.screenshot({
        type: "jpeg",
        quality: 60,
        fullPage: Boolean(step.fullPage),
      });
      shotsTaken.count += 1;
      return {
        ok: true,
        width,
        url: page.url(),
        image: `data:image/jpeg;base64,${buf.toString("base64")}`,
      };
    }
    default: {
      const unknown = step as { action: string };
      throw new BrowseError(`Unsupported action: ${unknown.action}`);
    }
  }
}

/**
 * Execute an ordered batch of browser actions against a running app and return
 * everything observed. Never throws for an individual failed step — a failure
 * is evidence, not an exception — but does throw when the session itself
 * cannot be established.
 */
export async function runBrowseSession(
  plan: BrowsePlan,
  heartbeat?: Heartbeat,
): Promise<BrowseReport> {
  if (!plan.actions.length) throw new BrowseError("No actions supplied");
  if (plan.actions.length > MAX_ACTIONS) {
    throw new BrowseError(`Too many actions (max ${MAX_ACTIONS})`);
  }
  const started = Date.now();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const steps: BrowseStepResult[] = [];
  const shotsTaken = { count: 0 };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: plan.viewport ?? { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      if (consoleErrors.length < MAX_LOG_ENTRIES) consoleErrors.push(clip(msg.text(), 400));
    });
    page.on("pageerror", (err) => {
      if (pageErrors.length < MAX_LOG_ENTRIES) pageErrors.push(clip(String(err?.message ?? err), 400));
    });
    page.on("requestfailed", (req) => {
      if (failedRequests.length < MAX_LOG_ENTRIES) {
        failedRequests.push(`${req.method()} ${clip(req.url(), 200)} — ${req.failure()?.errorText ?? "failed"}`);
      }
    });
    page.on("response", (res) => {
      if (res.status() < 400) return;
      if (failedRequests.length < MAX_LOG_ENTRIES) {
        failedRequests.push(`${res.status()} ${clip(res.url(), 200)}`);
      }
    });

    for (const step of plan.actions) {
      const at = Date.now();
      heartbeat?.beat(describeAction(step));
      try {
        const out = await runAction(page, plan.baseUrl, step, shotsTaken);
        steps.push({ action: step.action, durationMs: Date.now() - at, ...out });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const optional = "optional" in step && step.optional === true;
        steps.push({
          action: step.action,
          ok: optional,
          error: clip(message, 400),
          url: page.url(),
          durationMs: Date.now() - at,
        });
        // A hard navigation failure invalidates everything that follows, so we
        // stop rather than reporting a cascade of misleading step failures.
        if (!optional && step.action === "goto") break;
      }
    }

    const finalUrl = page.url();
    await context.close();
    return {
      ok: steps.every((s) => s.ok),
      baseUrl: plan.baseUrl,
      finalUrl,
      durationMs: Date.now() - started,
      steps,
      consoleErrors,
      pageErrors,
      failedRequests,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Plain-language label for the heartbeat, e.g. "opening /pricing". */
export function describeAction(step: BrowseAction): string {
  switch (step.action) {
    case "goto":
      return `opening ${step.path ?? "/"}`;
    case "click":
      return `clicking ${step.selector}`;
    case "type":
      return `filling ${step.selector}`;
    case "choose":
      return `choosing an option in ${step.selector}`;
    case "press":
      return `pressing ${step.key}`;
    case "scroll":
      return "scrolling the page";
    case "wait":
      return step.selector ? `waiting for ${step.selector}` : "waiting";
    case "text":
      return "reading the page text";
    case "html":
      return "reading the page markup";
    case "a11y":
      return "reading the accessibility tree";
    case "screenshot":
      return "taking a screenshot";
    default:
      return "working";
  }
}
