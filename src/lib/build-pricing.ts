/**
 * THE build pricing authority. Pure functions only — no I/O.
 *
 * Classes estimate effort and size the reservation; the final charge comes
 * from measured cost. Economics are passed in (from economics_config), never
 * hard-coded here. Nothing in this module is ever shown to a customer.
 */
export type BuildEconomics = {
  revenuePerCreditUsd: number;
  targetMarginPct: number;
  minChargeCredits: number;
  roundingStep: number;
  reservationHeadroom: number;
};

export const DEFAULT_BUILD_ECONOMICS: BuildEconomics = {
  revenuePerCreditUsd: 0.13,
  targetMarginPct: 80,
  minChargeCredits: 0.3,
  roundingStep: 0.01,
  reservationHeadroom: 3,
};

/** Variable cost one credit may carry: revenue × (1 − margin). 0.13 @ 80% → 0.026. */
export function costPerCreditUsd(e: BuildEconomics): number {
  const m = Math.min(99, Math.max(0, e.targetMarginPct));
  return e.revenuePerCreditUsd * (1 - m / 100);
}

/**
 * Kimble's maximum variable-cost exposure for one build: the held credits
 * expressed as cost. With no hold (auto-fix), the class estimate × headroom.
 */
export function economicCeilingUsd(reservedCredits: number | null, fallbackClassCostUsd: number, e: BuildEconomics): number {
  if (reservedCredits != null && reservedCredits > 0) return reservedCredits * costPerCreditUsd(e);
  return Math.max(0, fallbackClassCostUsd) * Math.max(1, e.reservationHeadroom);
}

function roundUp(n: number, step: number): number {
  const s = step > 0 ? step : 0.01;
  // tolerate float noise (0.1/0.026 etc.) before ceiling
  return Math.round(Math.ceil(n / s - 1e-9) * s * 100) / 100;
}

/** Credits for a measured USD cost: ceil to step; the minimum is a floor, never a flat price. */
export function creditsForCost(costUsd: number, e: BuildEconomics): number {
  const cpc = costPerCreditUsd(e);
  if (!(cpc > 0)) throw new Error("invalid economics: cost per credit must be > 0");
  const raw = Math.max(0, costUsd) / cpc;
  return Math.max(roundUp(e.minChargeCredits, e.roundingStep), roundUp(raw, e.roundingStep));
}

export type CostBasis = "actual" | "estimated" | "unknown";

export type PricedTurn = {
  /** Credits to settle (before the reservation cap applied by the DB). */
  amount: number;
  costUsd: number;
  basis: CostBasis;
  /** Calls whose cost had to come from the class estimate (no usage at all). */
  unknownCalls: number;
};

export type CallCost = { costUsd: number | null; basis: CostBasis };

/**
 * Price a turn from per-call costs. Calls with no measurable cost are never
 * treated as free: the class estimate stands in for the unmeasured part.
 */
export function priceTurnCost(
  calls: CallCost[],
  e: BuildEconomics,
  fallbackEstimateUsd: number,
): PricedTurn {
  let cost = 0;
  let actual = 0;
  let estimated = 0;
  let unknown = 0;
  for (const c of calls) {
    if (c.costUsd == null || !Number.isFinite(c.costUsd)) { unknown++; continue; }
    cost += Math.max(0, c.costUsd);
    if (c.basis === "actual") actual++; else estimated++;
  }
  if (unknown > 0) cost = Math.max(cost, fallbackEstimateUsd);
  const basis: CostBasis = unknown > 0 ? "unknown" : estimated > 0 || actual === 0 ? "estimated" : "actual";
  return { amount: creditsForCost(cost, e), costUsd: cost, basis, unknownCalls: unknown };
}

/** Estimated credits for a class from its p90 cost (measured or default). */
export function estimateCredits(classCostUsd: number, e: BuildEconomics): number {
  return creditsForCost(classCostUsd, e);
}

/** Pick the class cost: measured p90 when enough samples, else the default. */
export function classCostUsd(measuredP90: number | null | undefined, defaultUsd: number): { usd: number; basis: "measured_p90" | "default" } {
  return measuredP90 != null && measuredP90 > 0 ? { usd: measuredP90, basis: "measured_p90" } : { usd: defaultUsd, basis: "default" };
}

/** One AI call as durably recorded for a turn (ai_call_log). */
export type RecordedCall = {
  id?: string;
  stage: string | null;
  call_kind: string | null;
  status: number | null;
  cost_usd_micro: number | null;
  cost_basis: string | null;
};

/**
 * Post-turn background work (stage "after": memory/learning) runs after the
 * customer's result is saved; it is Kimble overhead, never billed.
 */
export function isBillableRecordedCall(r: RecordedCall): boolean {
  return r.stage !== "after";
}

/**
 * THE final cost of a turn: every billable call durably recorded for it.
 * Provider cost → actual; price-table cost → estimated; no cost → unknown
 * (class estimate stands in, never free). Rejected requests are $0.
 */
export function priceRecordedCalls(rows: RecordedCall[], e: BuildEconomics, fallbackEstimateUsd: number): PricedTurn & { billableCalls: number; overheadCalls: number } {
  const billable = rows.filter(isBillableRecordedCall);
  const calls: CallCost[] = billable.map((r) => {
    if (r.cost_usd_micro == null) {
      if (r.status != null && r.status >= 400) return { costUsd: 0, basis: "actual" };
      return { costUsd: null, basis: "unknown" };
    }
    return { costUsd: Number(r.cost_usd_micro) / 1_000_000, basis: r.cost_basis === "actual" ? "actual" : "estimated" };
  });
  return { ...priceTurnCost(calls, e, fallbackEstimateUsd), billableCalls: billable.length, overheadCalls: rows.length - billable.length };
}
