/**
 * Server-side wrappers around the credit system Postgres RPCs.
 *
 * The credit system supports fractional amounts (numeric(10,2)) so a small
 * build can cost ~1.00 while a large one costs 3.00+. See
 * `credit-pricing.server.ts` for how those amounts are computed.
 *
 * Flow used by /api/generate (charge ONLY after success):
 *   1. checkCreditBalance({ amount: BUILD_FLOOR }) -> 402 if not enough
 *      (no ledger row written, nothing taken from the user)
 *   2. run AI generation, capture token usage
 *   3. priceBuild(usage) -> finalAmount
 *   4. spendCredit({ amount: finalAmount, reason: 'ai_build_charge' })
 *      — this is the SINGLE charge for the whole build
 *   5. on failure: nothing to refund (we never charged)
 *
 * Same pattern for /api/discuss (flat 1.00 after success) and
 * /api/generate-image (flat 1.00 after success).
 *
 * Legacy reasons `ai_build_hold` / `ai_build_topup` / `ai_*_refund` are
 * still permitted by the DB CHECK constraint for historical ledger rows;
 * new code paths should not emit them.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SpendReason =
  | "ai_message"
  | "ai_image"
  | "ai_image_charge"
  | "ai_discuss"
  | "ai_discuss_charge"
  | "ai_coach_charge"
  | "ai_transcribe_charge"
  | "ai_build_hold"
  | "ai_build_topup"
  | "ai_build_charge";

export type SpendCreditOptions = {
  userId: string;
  amount: number;
  reason: SpendReason;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
};

export type SpendCreditResult =
  | { ok: true; ledgerId: string }
  | { ok: false; reason: "insufficient_credits" }
  | { ok: false; reason: "internal_error"; message: string };

/** Charge the user a numeric amount. The RPC walks daily-free → monthly grant
 *  → topup, splitting across buckets when needed. Returns the ledger row id
 *  so callers can refund this exact spend later. */
export async function spendCredit(opts: SpendCreditOptions): Promise<SpendCreditResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("spend_credit", {
      _user_id: opts.userId,
      _amount: opts.amount as never,
      _reason: opts.reason,
      _project_id: opts.projectId ?? undefined,
      _metadata: (opts.metadata as never) ?? {},
    });
    if (error) {
      console.error("[credits] spend_credit RPC error", error);
      return { ok: false, reason: "internal_error", message: error.message };
    }
    if (!data) {
      return { ok: false, reason: "insufficient_credits" };
    }
    return { ok: true, ledgerId: data as unknown as string };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[credits] spend_credit threw", e);
    return { ok: false, reason: "internal_error", message };
  }
}

export type RefundCreditOptions = {
  userId: string;
  ledgerId: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

/** Refund a previously-spent credit by ledger id. Returns the buckets to
 *  exactly the state they were in.
 *
 *  A dropped refund silently keeps money we didn't earn, so a single failed
 *  RPC is no longer just logged: we retry with backoff, and if every attempt
 *  fails we leave a durable marker in the ledger metadata trail via
 *  `refund_failed` so support can reconcile it. Returns whether the credit
 *  actually made it back to the user. */
export async function refundCredit(opts: RefundCreditOptions): Promise<boolean> {
  const attempts = 3;
  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const { error } = await supabaseAdmin.rpc("refund_credit", {
        _user_id: opts.userId,
        _ledger_id: opts.ledgerId,
        _reason: opts.reason,
        _metadata: (opts.metadata as never) ?? {},
      });
      if (!error) return true;
      lastError = error.message;
      console.error(`[credits] refund_credit RPC error (attempt ${i + 1}/${attempts})`, error);
    } catch (e) {
      lastError = e instanceof Error ? e.message : "unknown error";
      console.error(`[credits] refund_credit threw (attempt ${i + 1}/${attempts})`, e);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  // Durable breadcrumb: a human needs to hand this credit back.
  console.error("[credits] REFUND_FAILED — manual reconciliation required", {
    userId: opts.userId,
    ledgerId: opts.ledgerId,
    reason: opts.reason,
    lastError,
  });
  try {
    await supabaseAdmin.from("pipeline_failures").insert({
      stage: "credit_refund",
      user_id: opts.userId,
      error_message: `refund_credit failed after ${attempts} attempts: ${lastError}`,
      details: { ledgerId: opts.ledgerId, reason: opts.reason } as never,
    } as never);
  } catch {
    // Nothing left to do — the console line above is the last resort.
  }
  return false;
}

export type CheckBalanceResult =
  | { ok: true }
  | { ok: false; reason: "insufficient_credits" }
  | { ok: false; reason: "internal_error"; message: string };

/** Read-only "does the user have at least N credits available?" check.
 *  Mirrors the bucket math in `spend_credit` without writing anything,
 *  so we can 402 BEFORE kicking off an AI call without taking a hold. */
export async function checkCreditBalance(opts: {
  userId: string;
  amount: number;
}): Promise<CheckBalanceResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("check_credit_balance", {
      _user_id: opts.userId,
      _amount: opts.amount as never,
    });
    if (error) {
      console.error("[credits] check_credit_balance RPC error", error);
      return { ok: false, reason: "internal_error", message: error.message };
    }
    if (data === true) return { ok: true };
    return { ok: false, reason: "insufficient_credits" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[credits] check_credit_balance threw", e);
    return { ok: false, reason: "internal_error", message };
  }
}
