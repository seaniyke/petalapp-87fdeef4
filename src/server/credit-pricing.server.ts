/**
 * Variable per-build credit pricing.
 *
 * The `/api/generate` endpoint reserves a 1.00 "hold" credit before the AI
 * call, then computes the final cost from the AI gateway's `usage` payload
 * and tops up (or refunds) the difference. `/api/discuss` is a flat 1.00.
 *
 * Rationale (see plan.md):
 *   - Floor at 1.00 so the smallest build still costs the same as a discuss.
 *   - Completion tokens are weighted heavier than prompt tokens because
 *     they dominate real LLM cost.
 *   - Hard cap so a runaway response can't drain a wallet in a single turn.
 *
 * All the constants live in this file so we can tune pricing without
 * touching API logic.
 */

// Pricing tuned 2026-04-28: previous setup averaged ~6.8 credits/build with
// frequent cap hits at 8.0. Target is ~3-4 credits/build with cap at 6.0.
// Diff/patch output mode (see SYSTEM_PROMPT_PATCH) materially reduces
// completion tokens, so we can lower COMPLETION_RATE without losing margin.
// Pricing tuned 2026-05-05: token rates and base bumped ~1.8× to improve
// per-build margin while keeping the floor at 1.0 (so trivial tweaks still
// feel cheap). Cap raised in lockstep so multi-cycle turns aren't unfairly
// pinned to the ceiling under the new rates.
export const BUILD_HOLD = 1.5; // pre-flight reservation
export const BUILD_FLOOR = 1.0; // minimum charged after true-up
export const BUILD_BASE = 1.0; // additive base before token weighting
export const PROMPT_RATE = 0.06; // credits per 1k input tokens
export const COMPLETION_RATE = 0.28; // credits per 1k output tokens
// Cap raised to 20.0 to give headroom for the higher per-token rates on
// long, multi-cycle agentic turns. Still bounded in CREDITS, not tokens.
export const BUILD_CAP = 20.0; // max credits per single user turn
export const MISSING_USAGE_FALLBACK = 1.5; // when gateway omits usage data

export type GatewayUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type PricedBuild = {
  /** Final amount to charge the user (already rounded to 2 dp, clamped). */
  amount: number;
  /** True when usage came back zero/missing and we fell back to the constant. */
  usageMissing: boolean;
  /** True when the raw computation exceeded BUILD_CAP. */
  clamped: boolean;
  promptTokens: number;
  completionTokens: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the credit cost of a single build from the gateway's usage data. */
export function priceBuild(usage: GatewayUsage | null | undefined): PricedBuild {
  const promptTokens = Math.max(0, Math.floor(usage?.prompt_tokens ?? 0));
  const completionTokens = Math.max(0, Math.floor(usage?.completion_tokens ?? 0));

  if (promptTokens === 0 && completionTokens === 0) {
    return {
      amount: MISSING_USAGE_FALLBACK,
      usageMissing: true,
      clamped: false,
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const raw =
    BUILD_BASE +
    (promptTokens / 1000) * PROMPT_RATE +
    (completionTokens / 1000) * COMPLETION_RATE;

  const floored = Math.max(BUILD_FLOOR, raw);
  const clamped = floored > BUILD_CAP;
  const amount = round2(Math.min(BUILD_CAP, floored));

  return {
    amount,
    usageMissing: false,
    clamped,
    promptTokens,
    completionTokens,
  };
}

/**
 * Sum prompt + completion tokens across every sub-call (cycle) of a single
 * user turn, then run the same formula. Charged ONCE at end of turn so
 * users see one debit, not N. Internal autofix cycles MUST be excluded by
 * the caller before passing into this — same convention as `body.isAutoFix`.
 */
export function priceTurn(usages: Array<GatewayUsage | null | undefined>): PricedBuild {
  let prompt = 0;
  let completion = 0;
  for (const u of usages) {
    if (!u) continue;
    prompt += Math.max(0, Math.floor(u.prompt_tokens ?? 0));
    completion += Math.max(0, Math.floor(u.completion_tokens ?? 0));
  }
  return priceBuild({ prompt_tokens: prompt, completion_tokens: completion });
}
