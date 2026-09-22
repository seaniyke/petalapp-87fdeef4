/**
 * Runtime wallet → Kimble Credits fallback.
 *
 * Kimble historically kept two separate balances: build credits, and a
 * cents-denominated "runtime" wallet for Cloud + AI meters. Customers only
 * ever wanted ONE balance. This module is the bridge: when a runtime meter
 * charge fails purely because the runtime wallet is empty, we convert the
 * amount into Kimble Credits at the centralised internal rate and charge the
 * credit balance instead.
 *
 * Deliberate constraints:
 *   - OFF by default. Set PETAL_UNIFIED_BALANCE=1 to turn it on. Anything
 *     falsy (unset, "0", "off", "false", "no", "disabled") keeps today's
 *     behaviour exactly.
 *   - ONLY applies to `insufficient_balance`. Spend caps (project/workspace)
 *     are a deliberate user-set ceiling and must still block.
 *   - Never throws. Any failure returns "not handled" so the caller falls
 *     back to the existing block-and-explain path.
 *   - Writes a credit_ledger row with reason `runtime_fallback` and the meter
 *     in metadata, so every cent is traceable back to actual usage.
 */
import { economicsValue } from "@/server/economics-config.server";
import { spendCredit } from "@/server/credits.server";
import type { RuntimeMeter } from "@/server/runtime-wallet.server";

export function unifiedBalanceEnabled(): boolean {
  const raw = (process.env["PETAL_UNIFIED_BALANCE"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "on" || raw === "true" || raw === "yes" || raw === "enabled";
}

/** Cents of internal variable cost → Kimble Credits, at the centralised rate. */
export async function centsToCredits(cents: number): Promise<number> {
  const perCreditUsd = await economicsValue("target_variable_cost_per_credit_usd");
  const rate = perCreditUsd > 0 ? perCreditUsd : 0.05;
  const credits = cents / 100 / rate;
  // Round up to the cent-equivalent so we never under-charge into a loss,
  // but keep a floor so a sub-cent meter tick can't cost a whole credit.
  return Math.max(0.01, Math.round(credits * 100) / 100);
}

export type FallbackResult =
  | { handled: false }
  | { handled: true; ok: true; credits: number; ledgerId: string }
  | { handled: true; ok: false; credits: number };

export async function chargeCreditsForRuntime(opts: {
  userId: string;
  projectId?: string | null;
  meter: RuntimeMeter;
  cents: number;
  metadata?: Record<string, unknown>;
}): Promise<FallbackResult> {
  if (!unifiedBalanceEnabled()) return { handled: false };
  if (!Number.isFinite(opts.cents) || opts.cents <= 0) return { handled: false };
  try {
    const credits = await centsToCredits(opts.cents);
    const spend = await spendCredit({
      userId: opts.userId,
      amount: credits,
      reason: "runtime_fallback",
      projectId: opts.projectId ?? null,
      metadata: {
        ...(opts.metadata ?? {}),
        runtime_meter: opts.meter,
        runtime_cents: Math.round(opts.cents),
        conversion: "runtime_wallet_empty",
      },
    });
    if (spend.ok) {
      console.info("[runtime-fallback] charged credits for runtime meter", {
        meter: opts.meter,
        cents: Math.round(opts.cents),
        credits,
      });
      return { handled: true, ok: true, credits, ledgerId: spend.ledgerId };
    }
    return { handled: true, ok: false, credits };
  } catch (e) {
    console.error("[runtime-fallback] threw, leaving original outcome in place", e);
    return { handled: false };
  }
}
