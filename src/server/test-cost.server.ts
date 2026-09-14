/**
 * Test Lab cost policy — proving the app works without spending like it.
 *
 * Testing is the most expensive thing Petal can do per build: a browser
 * session costs wall-clock on the build service, and asking a model to look
 * at a screenshot costs real money. The policy here is deliberately boring:
 *
 *   1. Cheap deterministic evidence first. Compile, static checks and the
 *      backend probe already ran — a case whose answer is already known from
 *      that evidence never opens a browser.
 *   2. Browser next, batched. One session covers several cases; screenshots
 *      are capped per run, not per case.
 *   3. AI last, and only where it adds something. A model is asked to look at
 *      a screenshot only for a *failed* must-work case, reusing the shots the
 *      browser already took. Never for a passing case, never for cosmetics.
 *
 * Model escalation follows the same shape: the cheap model classifies, and we
 * only escalate when the cheap answer was not good enough — a repeat failure,
 * an unreadable diagnosis, or a genuinely visual question.
 *
 * Pure functions. No IO, so the rules are testable and identical everywhere.
 */
import type { TestBudget } from "@/server/test-plan.server";

/** Hard ceilings for one test run, whatever the budget says. */
export const TEST_LIMITS = {
  /** Browser batches per run (each covers several cases). */
  maxSessions: 8,
  /** Screenshots kept per run — evidence, not a gallery. */
  maxScreenshots: 12,
  /** AI screenshot reviews per run. Only failed must-work cases qualify. */
  maxAiReviews: 3,
  /** Wall-clock a run may consume before remaining cases are skipped. */
  maxRunMs: 8 * 60 * 1000,
} as const;

export type ModelTier = "fast" | "strong";

/**
 * How much testing this build gets.
 *
 * Paid accounts get the full plan. Free accounts get the full plan too, until
 * the month's cost ceiling says otherwise — then must-work checks only. A
 * repair retest is always tight: we are re-proving a known set, not exploring.
 */
export function chooseTestBudget(args: {
  paid: boolean;
  /** From the free-account cost ceiling. */
  degrade: boolean;
  /** 0 for the first run, 1+ for retests after a repair. */
  attempt: number;
  /** Time already spent on this turn, if the caller is tracking it. */
  elapsedMs?: number;
}): TestBudget {
  if (args.degrade && !args.paid) return "minimal";
  if ((args.elapsedMs ?? 0) >= TEST_LIMITS.maxRunMs) return "minimal";
  if (args.attempt > 0) return "tight";
  return args.paid ? "full" : "tight";
}

export type StageDecision = { run: boolean; reason: string };

/**
 * Should the browser open at all for this case? Deterministic evidence that
 * already answers the question is cheaper and just as true.
 */
export function shouldOpenBrowser(args: {
  priority: string;
  /** The build did not ship — there is nothing deployed to drive. */
  shipped: boolean;
  /** Static/compile evidence already proves this case fails. */
  knownFailure?: boolean;
  sessionsUsed: number;
}): StageDecision {
  if (!args.shipped) return { run: false, reason: "nothing deployed to test" };
  if (args.knownFailure) {
    return { run: false, reason: "already proven broken by the build checks" };
  }
  if (args.sessionsUsed >= TEST_LIMITS.maxSessions) {
    return { run: false, reason: "browser budget for this run is spent" };
  }
  return { run: true, reason: "needs a real browser" };
}

/**
 * Should a model look at this case's screenshot? Only when a must-work check
 * failed and we already have a picture of the failure.
 */
export function shouldAskAi(args: {
  status: string;
  priority: string;
  hasScreenshot: boolean;
  reviewsUsed: number;
}): StageDecision {
  if (args.reviewsUsed >= TEST_LIMITS.maxAiReviews) {
    return { run: false, reason: "review budget for this run is spent" };
  }
  if (args.status !== "failed") return { run: false, reason: "nothing failed to look at" };
  if (args.priority === "P2") return { run: false, reason: "cosmetic check, not worth a review" };
  if (!args.hasScreenshot) return { run: false, reason: "no screenshot to reason about" };
  return { run: true, reason: "a must-work check failed and we have the picture" };
}

/**
 * Which model diagnoses this failure. Cheap by default; escalate only when
 * the cheap path has demonstrably not worked.
 */
export function chooseDiagnosisModel(args: {
  /** How many times this same defect has already been seen this turn. */
  repeats: number;
  /** The failure is about what the page looks like, not what it did. */
  visual?: boolean;
  /** The cheap model returned something unusable. */
  lowConfidence?: boolean;
}): { tier: ModelTier; reason: string } {
  if (args.repeats >= 1) {
    return { tier: "strong", reason: "the cheap fix did not hold" };
  }
  if (args.lowConfidence) return { tier: "strong", reason: "the cheap diagnosis was unusable" };
  if (args.visual) return { tier: "strong", reason: "the question is visual" };
  return { tier: "fast", reason: "first look at a straightforward failure" };
}

/**
 * Rough variable cost of a run, for the economics record. Estimated, never
 * presented as an actual charge — the real model spend is recorded per call
 * by the provider telemetry and is the source of truth.
 */
export function estimateRunCostUsd(args: {
  sessions: number;
  screenshots: number;
  aiReviews: number;
}): number {
  // Build-service wall clock, roughly a browser batch at a time, plus the
  // vision calls. Deliberately coarse: this is a coverage signal, not a bill.
  const sessionUsd = 0.004;
  const screenshotUsd = 0.0002;
  const reviewUsd = 0.006;
  const total =
    args.sessions * sessionUsd +
    args.screenshots * screenshotUsd +
    args.aiReviews * reviewUsd;
  return Math.round(total * 1e6) / 1e6;
}

/** One internal line summarising what the run spent its budget on. */
export function describeSpend(args: {
  sessions: number;
  screenshots: number;
  aiReviews: number;
  budget: TestBudget;
}): string {
  return `test budget ${args.budget}: ${args.sessions} browser batch${
    args.sessions === 1 ? "" : "es"
  }, ${args.screenshots} screenshot${args.screenshots === 1 ? "" : "s"}, ${
    args.aiReviews
  } AI review${args.aiReviews === 1 ? "" : "s"} (~$${estimateRunCostUsd(args).toFixed(4)})`;
}
