/**
 * Thin server-side wrappers around the `spend_credit` and `refund_credit`
 * Postgres RPCs. Both AI generation endpoints (`/api/generate` and
 * `/api/generate-image`) call `spendCredit` BEFORE invoking the upstream
 * provider, then `refundCredit` if the call ultimately fails so the user
 * isn't charged for nothing.
 *
 * These functions use the admin client because the underlying RPCs are
 * SECURITY DEFINER and we always pass an explicit `_user_id` we already
 * authenticated upstream.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SpendCreditOptions = {
  userId: string;
  reason: "ai_message" | "ai_image";
  projectId?: string | null;
  metadata?: Record<string, unknown>;
};

export type SpendCreditResult =
  | { ok: true }
  /** User has no credits left in any bucket. */
  | { ok: false; reason: "insufficient_credits" }
  /** Something else went wrong (DB error). Caller should fail closed. */
  | { ok: false; reason: "internal_error"; message: string };

/** Charge the user one credit. Returns ok:true on success, or the reason
 *  the charge failed. Callers MUST treat ok:false as "do not invoke the
 *  paid upstream call". */
export async function spendCredit(opts: SpendCreditOptions): Promise<SpendCreditResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("spend_credit", {
      _user_id: opts.userId,
      _reason: opts.reason,
      _project_id: opts.projectId ?? undefined,
      _metadata: (opts.metadata as never) ?? {},
    });
    if (error) {
      console.error("[credits] spend_credit RPC error", error);
      return { ok: false, reason: "internal_error", message: error.message };
    }
    if (data === false) {
      return { ok: false, reason: "insufficient_credits" };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[credits] spend_credit threw", e);
    return { ok: false, reason: "internal_error", message };
  }
}

/** Refund a previously-spent credit. Best-effort: if it fails we log and
 *  swallow because there's no good way to surface this to the user — the
 *  important thing is that the original spend already returned ok. */
export async function refundCredit(opts: SpendCreditOptions): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("refund_credit", {
      _user_id: opts.userId,
      _reason: `${opts.reason}_refund`,
      _project_id: opts.projectId ?? undefined,
      _metadata: (opts.metadata as never) ?? {},
    });
    if (error) {
      console.error("[credits] refund_credit RPC error — credit not refunded", error);
    }
  } catch (e) {
    console.error("[credits] refund_credit threw — credit not refunded", e);
  }
}
