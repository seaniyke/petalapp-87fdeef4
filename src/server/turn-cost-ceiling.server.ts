/**
 * Per-turn cost ceiling — AI Generation Bible §7 and §12.
 *
 * "Repair is bounded: max attempts per gate, max total repair rounds per turn,
 *  and a hard cost ceiling. Exceeding any of them ends the turn with an honest
 *  error, not another retry."
 *
 * Round counts alone don't bound spend: one repair round on a 40-file project
 * with a frontier model can cost more than ten rounds on a small one. This
 * module is the missing dollar-denominated bound. It is deliberately a plain
 * in-memory meter keyed by turn — a turn lives inside one request, so there is
 * nothing to persist and nothing to race.
 *
 * Repair spend is Kimble's cost, never the user's (§12), so the ceiling exists
 * to protect Kimble's margin and to stop pathological loops — it must never be
 * surfaced as "you ran out".
 */

import { estimateMessagesTokens, type BudgetMessage } from "./context/budget";

/** Hard ceiling on model spend for the repair phase of a single turn, USD. */
export const TURN_REPAIR_COST_CEILING_USD = 4;

/** Soft ceiling — past this, repair may run but only cheap/deterministic tiers. */
export const TURN_REPAIR_COST_WARN_USD = 3;

/**
 * Coarse blended $/1M-token rates. Deliberately pessimistic (output-weighted)
 * so the meter over-estimates rather than letting a loop run long.
 */
const BLENDED_RATE_PER_MTOK: Record<string, number> = {
  "google/gemini-3.1-flash-lite": 3.5,
  "google/gemini-3.8-flash": 9,
  "google/gemini-4-argon": 24,
  "openai/gpt-5.6-luna": 2.8,
  "openai/gpt-5.6-sol": 48,
  "openai/gpt-6-astra": 120,
};

const DEFAULT_RATE_PER_MTOK = 5;

export function estimateCostUsd(model: string, tokens: number): number {
  const rate = BLENDED_RATE_PER_MTOK[model] ?? DEFAULT_RATE_PER_MTOK;
  return (tokens / 1_000_000) * rate;
}

export interface CostChargeResult {
  /** Total spend attributed to this turn's repair phase so far, USD. */
  spentUsd: number;
  /** True once the soft ceiling is crossed — downgrade to cheap tiers. */
  degrade: boolean;
  /** True once the hard ceiling is crossed — stop repairing, disclose. */
  exhausted: boolean;
}

export class TurnCostMeter {
  private spent = 0;
  private ceiling: number;
  private readonly warn: number;
  /** Ordered log of what the repair phase spent money on, for telemetry. */
  readonly entries: Array<{ label: string; model: string; tokens: number; usd: number }> = [];

  constructor(opts?: { ceilingUsd?: number; warnUsd?: number }) {
    this.ceiling = opts?.ceilingUsd ?? TURN_REPAIR_COST_CEILING_USD;
    this.warn = opts?.warnUsd ?? TURN_REPAIR_COST_WARN_USD;
  }

  /** Lower the hard ceiling to the turn's remaining economic budget (never raises it). */
  capAt(usd: number): void {
    const c = Math.max(0, usd);
    if (c < this.ceiling) this.ceiling = c;
  }

  get ceilingUsd(): number {
    return this.ceiling;
  }

  get spentUsd(): number {
    return this.spent;
  }

  /** True if another call at roughly `estimatedTokens` would breach the ceiling. */
  canAfford(model: string, estimatedTokens: number): boolean {
    return this.spent + estimateCostUsd(model, estimatedTokens) <= this.ceiling;
  }

  /** Record spend. Call AFTER a repair model call, with real or estimated tokens. */
  charge(label: string, model: string, tokens: number): CostChargeResult {
    const usd = estimateCostUsd(model, tokens);
    this.spent += usd;
    this.entries.push({ label, model, tokens, usd });
    return this.status();
  }

  /** Estimate + charge from an assembled messages payload. */
  chargeMessages(
    label: string,
    model: string,
    messages: BudgetMessage[],
    expectedOutputTokens = 4_000,
  ): CostChargeResult {
    return this.charge(label, model, estimateMessagesTokens(messages) + expectedOutputTokens);
  }

  status(): CostChargeResult {
    return {
      spentUsd: this.spent,
      degrade: this.spent >= this.warn,
      exhausted: this.spent >= this.ceiling,
    };
  }

  /** One-line telemetry summary. */
  summary(): string {
    return `repair spend $${this.spent.toFixed(4)} over ${this.entries.length} call(s)`;
  }
}
