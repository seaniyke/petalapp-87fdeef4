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

export const BUILD_HOLD = 1.0; // pre-flight reservation
export const BUILD_FLOOR = 1.0; // minimum charged after true-up
export const BUILD_BASE = 1.0; // additive base before token weighting
export const PROMPT_RATE = 0.05; // credits per 1k input tokens
export const COMPLETION_RATE = 0.3; // credits per 1k output tokens
export const BUILD_CAP = 8.0; // max credits per single build
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
