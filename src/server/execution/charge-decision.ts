/**
 * Charging decision — SHADOW mode.
 *
 * Decides whether a turn is chargeable and what it WOULD cost under a
 * measured-cost model, next to what the live pricing actually charged. Live
 * charging is unchanged (settlement still uses the existing path); this record
 * exists so credit bands can later be fitted from real data.
 *
 * Never chargeable: provider/infrastructure failures, browser disconnects,
 * Kimble bugs, duplicate execution by Kimble, failed Kimble recovery, and
 * rollbacks by Kimble's safety checks — i.e. anything that did not commit a
 * change the customer asked for.
 */
import type { ExecutionClass } from "./complexity";

export type FailureOrigin = "code" | "infrastructure" | "cancelled" | "kimble" | null;

export interface ChargeDecisionInput {
  executionClass: ExecutionClass;
  committed: boolean;
  /** Only a turn whose request was fulfilled with committed files. */
  outcome: "applied" | "answered" | "blocked" | "failed" | "aborted";
  failureOrigin: FailureOrigin;
  isAutoFix: boolean;
  actualCostUsd: number | null;
  expectedCostUsd: number;
  /** Credits the live path charged. */
  liveCharged: number;
  costPerCreditUsd: number;
  /** Measured cost of calls that produced nothing usable (stalls, discarded resends). */
  wastedCostUsd?: number;
}

export interface ChargeDecision {
  chargeable: boolean;
  reason: string;
  /** What the measured-cost model would charge (credits, 2dp). */
  wouldChargeCredits: number;
  liveCharged: number;
  /** actual / expected — >1 means the class baseline under-estimated. */
  costRatio: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function decideCharge(i: ChargeDecisionInput): ChargeDecision {
  const base = { liveCharged: i.liveCharged, costRatio: i.actualCostUsd != null && i.expectedCostUsd > 0 ? round2(i.actualCostUsd / i.expectedCostUsd) : null };
  if (i.isAutoFix) return { ...base, chargeable: false, reason: "kimble_auto_fix", wouldChargeCredits: 0 };
  if (i.outcome === "aborted" || i.failureOrigin === "cancelled") return { ...base, chargeable: false, reason: "cancelled_before_commit", wouldChargeCredits: 0 };
  if (!i.committed) {
    const reason =
      i.failureOrigin === "infrastructure" ? "provider_or_infrastructure_failure"
      : i.failureOrigin === "kimble" ? "kimble_internal_failure"
      : i.outcome === "failed" || i.outcome === "blocked" ? "rolled_back_by_safety_checks"
      : "no_committed_change";
    return { ...base, chargeable: false, reason, wouldChargeCredits: 0 };
  }
  if (i.actualCostUsd == null || !(i.costPerCreditUsd > 0)) {
    return { ...base, chargeable: true, reason: "committed_cost_unknown_live_price_kept", wouldChargeCredits: i.liveCharged };
  }
  // Waste caused by Kimble (dead streams, discarded resends) is not billed.
  const billable = Math.max(0, i.actualCostUsd - (i.wastedCostUsd ?? 0));
  return { ...base, chargeable: true, reason: "committed_measured_cost", wouldChargeCredits: round2(billable / i.costPerCreditUsd) };
}
