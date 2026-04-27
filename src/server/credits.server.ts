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
 *  exactly the state they were in. Best-effort: if it fails we log and
 *  swallow because there's no good way to surface this to the user. */
export async function refundCredit(opts: RefundCreditOptions): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("refund_credit", {
      _user_id: opts.userId,
      _ledger_id: opts.ledgerId,
      _reason: opts.reason,
      _metadata: (opts.metadata as never) ?? {},
    });
    if (error) {
      console.error("[credits] refund_credit RPC error — credit not refunded", error);
    }
  } catch (e) {
    console.error("[credits] refund_credit threw — credit not refunded", e);
  }
}
