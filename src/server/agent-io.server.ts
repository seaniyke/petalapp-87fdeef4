/**
 * AgentIO — the seam between the generation core and where it runs.
 *
 * Phase 2 of the Railway move. Every saved-data touch at the commit point
 * goes through this interface. The Worker uses the direct adapter below
 * (identical behaviour to before). The Railway runtime will provide an
 * adapter that calls the signed `/api/public/agent/ops` gateway.
 *
 * Adapters must preserve: Stop wins before commit; settlement idempotent on
 * the turn id; files saved only after the commit claim.
 */
import { currentTurnContext } from "@/server/turn-context.server";

export type SettleCharge = {
  userId: string;
  amount: number;
  projectId: string | null;
  turnId: string | null;
  metadata: Record<string, unknown>;
};
export type SettleOutcome = { charged: number; shortfall: number; idempotent: boolean };
export type BalanceOutcome = { ok: true } | { ok: false; reason: "insufficient_credits" | "internal_error" };

export interface AgentIO {
  readonly kind: "direct" | "gateway";
  /** Throws "Stopped by user before <stage>" when the turn was stopped. */
  assertActive(turnId: string | undefined, signal: AbortSignal | undefined, stage: string): Promise<void>;
  /** Commit point. Throws if Stop won the race. */
  claimCommit(turnId: string | undefined, signal: AbortSignal | undefined): Promise<void>;
  checkBalance(userId: string, amount: number): Promise<BalanceOutcome>;
  /** Throws on failure (caller records it as unpaid, as before). */
  settleCharge(args: SettleCharge): Promise<SettleOutcome>;
  /** Returns an error message instead of throwing (persistence is logged, not fatal). */
  replaceFiles(projectId: string, files: Array<{ path: string; content: string }>): Promise<string | null>;
}

export function createDirectAgentIO(): AgentIO {
  return {
    kind: "direct",
    async assertActive(turnId, signal, stage) {
      await (await import("@/server/turn-cancel.server")).assertTurnActive(turnId, signal, stage);
    },
    async claimCommit(turnId, signal) {
      await (await import("@/server/turn-cancel.server")).claimTurnCommit(turnId, signal);
    },
    async checkBalance(userId, amount) {
      const { checkCreditBalance } = await import("@/server/credits.server");
      const r = await checkCreditBalance({ userId, amount });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    async settleCharge(a) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("settle_build_charge", {
        _user_id: a.userId,
        _amount: a.amount,
        _reason: "ai_build_charge",
        _project_id: a.projectId ?? undefined,
        _turn_id: a.turnId ?? undefined,
        _metadata: a.metadata as never,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { charged?: number; shortfall?: number; idempotent?: boolean }
        | null;
      return { charged: Number(row?.charged ?? 0), shortfall: Number(row?.shortfall ?? 0), idempotent: !!row?.idempotent };
    },
    async replaceFiles(projectId, files) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("replace_project_files", { _project_id: projectId, _files: files } as never);
      return error ? error.message : null;
    },
  };
}

let direct: AgentIO | null = null;
/** The adapter for the current turn: the turn's own, else direct. */
export function agentIO(): AgentIO {
  return currentTurnContext()?.agentIO ?? (direct ??= createDirectAgentIO());
}
