/** Database-backed AgentOpsStore used by the signed agent-ops endpoint. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refundCredit } from "@/server/credits.server";
import type { AgentOpsStore, TurnRow } from "@/server/agent-ops.server";

type Any = never;

export function createAgentOpsStore(): AgentOpsStore {
  const db = supabaseAdmin;
  return {
    async getTurn(turnId) {
      const { data } = await db
        .from("turns")
        .select("id,user_id,project_id,status,committed_at")
        .eq("id", turnId)
        .maybeSingle();
      return (data as TurnRow | null) ?? null;
    },
    async readFiles(projectId) {
      const { data, error } = await db.from("project_files").select("path,content").eq("project_id", projectId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ path: r.path, content: r.content ?? "" }));
    },
    async replaceFiles(projectId, files) {
      const { error } = await db.rpc("replace_project_files", { _project_id: projectId, _files: files } as Any);
      if (error) throw new Error(error.message);
    },
    async readMemory(projectId) {
      const { data } = await db.from("project_memory").select("key,value").eq("project_id", projectId);
      return (data ?? []) as Array<{ key: string; value: string }>;
    },
    async readBlueprint(projectId) {
      const { data } = await db
        .from("project_blueprints")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    async appendEvents(turnId, events) {
      const { error } = await db
        .from("turn_events")
        .insert(events.map((e) => ({ turn_id: turnId, seq: e.seq, kind: e.kind, payload: (e.payload ?? {}) as Any })));
      if (error) throw new Error(error.message);
      await db
        .from("turns")
        .update({ last_seq: events[events.length - 1].seq, last_progress_at: new Date().toISOString() })
        .eq("id", turnId)
        .eq("status", "running");
    },
    async claimCommit(turnId) {
      const { data, error } = await db
        .from("turns")
        .update({ committed_at: new Date().toISOString() })
        .eq("id", turnId)
        .eq("status", "running")
        .is("committed_at", null)
        .select("id");
      return !error && !!data && data.length > 0;
    },
    async finishTurn(turnId, status, extras) {
      await db
        .from("turns")
        .update({
          status,
          ended_at: new Date().toISOString(),
          error_message: extras.errorMessage ?? null,
          credits_charged: extras.creditsCharged ?? null,
        })
        .eq("id", turnId)
        .eq("status", "running");
    },
    async checkBalance(userId, amount) {
      const { data } = await db.rpc("check_credit_balance", { _user_id: userId, _amount: amount as Any });
      return data === true;
    },
    async findChargeForTurn(userId, turnId, reason) {
      const { data } = await db
        .from("credit_ledger")
        .select("id")
        .eq("user_id", userId)
        .eq("reason", reason)
        .or(`turn_id.eq.${turnId},metadata->>turn_id.eq.${turnId}`)
        .limit(1)
        .maybeSingle();
      return (data as { id: string } | null)?.id ?? null;
    },
    async spend({ userId, projectId, turnId, amount, reason }) {
      const { data, error } = await db.rpc("spend_credit", {
        _user_id: userId,
        _amount: amount as Any,
        _reason: reason,
        _project_id: projectId,
        _metadata: { turn_id: turnId, via: "agent_ops" } as Any,
      });
      if (error || !data) return null;
      const ledgerId = data as unknown as string;
      await db.from("credit_ledger").update({ turn_id: turnId }).eq("id", ledgerId);
      return ledgerId;
    },
    async ledgerOwner(ledgerId) {
      const { data } = await db.from("credit_ledger").select("user_id,turn_id,metadata").eq("id", ledgerId).maybeSingle();
      if (!data) return null;
      const meta = (data.metadata ?? {}) as { turn_id?: string };
      return { user_id: data.user_id, turn_id: data.turn_id ?? meta.turn_id ?? null };
    },
    refund: ({ userId, ledgerId, reason }) => refundCredit({ userId, ledgerId, reason }),
    async logAiCall(row) {
      await db.from("ai_call_log").insert(row as Any);
    },
    async savePicture(row) {
      const { error } = await db.from("project_pictures").insert(row);
      if (error) throw new Error(error.message);
    },
  };
}
