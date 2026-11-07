/**
 * Model-aware cost estimate for a first-build tool loop — pure, no I/O.
 *
 * The runaway ceiling is "size estimate × headroom". The class estimates in
 * economics_config are flat dollar figures from the DeepSeek era ($0.03–$0.15)
 * and know nothing about which model runs; on the gateway's first-build model
 * every build hit that cap after one or two steps. Here the size estimate is
 * the p90 of MEASURED first-build token usage (uncached / cached / output),
 * priced at the model the loop will actually run. Tokens are model-neutral, so
 * changing the model re-prices history instead of inheriting old dollars.
 */
import type { ModelPrice } from "@/server/ai-provider.server";

export type TokenSample = { prompt: number; cached: number; completion: number };

/**
 * Fallback profile when fewer than `minSamples` measured first builds exist:
 * close to the measured p90 of 32 real first builds (7 Nov 2026 audit — about
 * 900k prompt tokens, ~72% served from cache, ~30k output).
 */
export const DEFAULT_FIRST_BUILD_TOKENS: TokenSample = { prompt: 900_000, cached: 650_000, completion: 30_000 };

export function sampleCostUsd(s: TokenSample, price: ModelPrice): number {
  const prompt = Math.max(0, s.prompt);
  const cached = Math.min(Math.max(0, s.cached), prompt);
  const out = Math.max(0, s.completion);
  return ((prompt - cached) * price.inUsd + cached * price.cachedInUsd + out * price.outUsd) / 1_000_000;
}

export function percentile(values: number[], p: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}

export type LoopCostEstimate = { usd: number; basis: "measured_p90" | "default"; samples: number };

/** p90 first-build cost at `price`; default profile below `minSamples`. */
export function estimateFirstBuildCost(samples: TokenSample[], price: ModelPrice, minSamples: number): LoopCostEstimate {
  const usable = samples.filter((s) => s.prompt > 0 || s.completion > 0);
  if (usable.length >= Math.max(1, minSamples)) {
    return { usd: percentile(usable.map((s) => sampleCostUsd(s, price)), 90), basis: "measured_p90", samples: usable.length };
  }
  return { usd: sampleCostUsd(DEFAULT_FIRST_BUILD_TOKENS, price), basis: "default", samples: usable.length };
}

/**
 * Pessimistic cost of the NEXT call before it is sent: every prompt token at
 * the uncached rate plus `expectedOutputTokens`. Used so the very first call
 * is checked against the ceiling too (the largest-seen predictor starts at 0).
 */
export function predictCallCostUsd(promptTokens: number, price: ModelPrice, expectedOutputTokens = 4_000): number {
  return (Math.max(0, promptTokens) * price.inUsd + Math.max(0, expectedOutputTokens) * price.outUsd) / 1_000_000;
}
