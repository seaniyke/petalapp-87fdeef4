/** Database-backed AgentOpsStore used by the signed agent-ops endpoint. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refundCredit } from "@/server/credits.server";
import type { AgentOpsStore, TurnRow } from "@/server/agent-ops.server";

type Any = never;

/** "harbor-lane-coffee" → "Harbor Lane Coffee". Generic scaffold names are ignored. */
export function titleFromPackageJson(content: string): string | null {
  let name = "";
  try {
    name = String((JSON.parse(content) as { name?: unknown }).name ?? "");
  } catch {
    return null;
  }
  name = name.replace(/^@[^/]+\//, "").trim();
  if (!name || /^(app|my-app|vite-project|vite-react|react-app|project|template|vite_react_shadcn_ts|kimble-app|petal-app|generated-app)$/i.test(name)) return null;
  const words = name.split(/[-_\s]+/).filter(Boolean).slice(0, 6);
  if (!words.length) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 60);
}

export function createAgentOpsStore(appOrigin?: string): AgentOpsStore {
  const db = supabaseAdmin;
  return {
    async startBuild(projectId, userId, turnId) {
      const secret = process.env.BUILDER_SHARED_SECRET;
      if (!secret || !appOrigin) return false;
      // The revision this turn committed is passed explicitly so the build is
      // bound to it (the trigger refuses a superseded revision).
      const { data: t } = await db.from("turns").select("committed_revision").eq("id", turnId).maybeSingle();
      const revision = (t as { committed_revision?: number | null } | null)?.committed_revision ?? undefined;
      const res = await fetch(new URL("/api/builds/trigger", appOrigin), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret, "x-petal-internal-user": userId },
        body: JSON.stringify({ projectId, turnId, ...(revision != null ? { revision: Number(revision) } : {}) }),
      }).catch(() => null);
      return !!res?.ok;
    },
    async getTurn(turnId) {
      const { data } = await db
        .from("turns")
        .select("id,user_id,project_id,status,committed_at")
        .eq("id", turnId)
        .maybeSingle();
      return (data as TurnRow | null) ?? null;
    },
    async nameUntitledProject(projectId) {
      try {
        const { data: proj } = await db.from("projects").select("title").eq("id", projectId).maybeSingle();
        if ((proj as { title?: string } | null)?.title !== "Untitled project") return;
        const { data: pkg } = await db
          .from("project_files")
          .select("content")
          .eq("project_id", projectId)
          .eq("path", "package.json")
          .maybeSingle();
        const title = titleFromPackageJson((pkg as { content?: string } | null)?.content ?? "");
        if (!title) return;
        const { slugifyForProject } = await import("@/lib/projects");
        await db
          .from("projects")
          .update({ title, slug: slugifyForProject(title, projectId) } as Any)
          .eq("id", projectId)
          .eq("title", "Untitled project");
      } catch {
        /* best-effort */
      }
    },
    async readFiles(projectId) {
      const { data, error } = await db.from("project_files").select("path,content").eq("project_id", projectId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ path: r.path, content: r.content ?? "" }));
    },
    async replaceFiles(projectId, files, turnId) {
      const { data, error } = await db.rpc("replace_project_files", {
        _project_id: projectId,
        _files: files,
        ...(turnId ? { _turn_id: turnId } : {}),
      } as Any);
      if (error) throw new Error(error.message);
      return data == null ? null : Number(data);
    },
    async readMemory(projectId) {
      const { data } = await db.from("project_memory").select("key,value").eq("project_id", projectId);
      return (data ?? []) as Array<{ key: string; value: string }>;
    },
    async readBlueprint(projectId) {
      const { data } = await db.from("project_blueprints").select("blueprint").eq("project_id", projectId).maybeSingle();
      return ((data as { blueprint?: Record<string, unknown> } | null)?.blueprint ?? null);
    },
    async saveBlueprint(projectId, columns, blueprint) {
      const existing = await this.readBlueprint(projectId);
      const { error } = await db
        .from("project_blueprints")
        .upsert({ ...columns, project_id: projectId, blueprint: { ...(existing ?? {}), ...blueprint } } as Any, { onConflict: "project_id" });
      if (error) throw new Error(error.message);
    },
    async appendEvents(turnId, events) {
      const { error } = await db
        .from("turn_events")
        .upsert(events.map((e) => ({ turn_id: turnId, seq: e.seq, kind: e.kind, payload: (e.payload ?? {}) as Any })), { onConflict: "turn_id,seq", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      await db
        .from("turns")
        .update({ last_seq: events[events.length - 1].seq, last_progress_at: new Date().toISOString() })
        .eq("id", turnId)
        .eq("status", "running");
    },
    async heartbeat(turnId, lease) {
      const { data, error } = await db.rpc("claim_turn_heartbeat" as Any, { _turn_id: turnId, _lease: lease } as Any);
      if (error) return "ok";
      return ((data as unknown) as "ok" | "lost" | "terminal") ?? "ok";
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
    async settle({ userId, projectId, turnId, amount, metadata }) {
      const { data, error } = await db.rpc("settle_build_charge", {
        _user_id: userId,
        _amount: amount,
        _reason: "ai_build_charge",
        _project_id: projectId,
        _turn_id: turnId,
        _metadata: metadata as Any,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { charged?: number; shortfall?: number; ledger_id?: string; idempotent?: boolean }
        | null;
      return {
        charged: Number(row?.charged ?? 0),
        shortfall: Number(row?.shortfall ?? 0),
        ledgerId: row?.ledger_id ?? null,
        idempotent: !!row?.idempotent,
      };
    },
    async ledgerOwner(ledgerId) {
      const { data } = await db.from("credit_ledger").select("user_id,turn_id,metadata").eq("id", ledgerId).maybeSingle();
      if (!data) return null;
      const meta = (data.metadata ?? {}) as { turn_id?: string };
      return { user_id: data.user_id, turn_id: data.turn_id ?? meta.turn_id ?? null };
    },
    refund: ({ userId, ledgerId, reason }) => refundCredit({ userId, ledgerId, reason }),
    async logAiCall(row) {
      const { data } = await db.from("ai_call_log").insert(row as Any).select("id").single();
      return (data as { id?: string } | null)?.id ?? null;
    },
    async updateAiCall(turnId, id, patch) {
      const { data } = await db.from("ai_call_log").update(patch as Any).eq("id", id).eq("turn_id", turnId).select("id");
      return !!data && data.length > 0;
    },
    async runQuery(q) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (db as any).from(q.table);
      let b =
        q.action === "select"
          ? t.select(q.columns ?? "*")
          : q.action === "insert"
            ? t.insert(q.values)
            : q.action === "upsert"
              ? t.upsert(q.values, q.onConflict ? { onConflict: q.onConflict } : undefined)
              : q.action === "update"
                ? t.update(q.values)
                : t.delete();
      if (q.scopeCol && q.action !== "insert" && q.action !== "upsert") b = b.eq(q.scopeCol, q.scopeValue);
      for (const f of q.filters) {
        b = f.op === "not_is" ? b.not(f.col, "is", f.value) : b[f.op](f.col, f.value);
      }
      if (q.action !== "select" && q.returning) b = b.select(q.columns ?? "*");
      if (q.order) b = b.order(q.order.col, { ascending: q.order.ascending });
      if (q.limit) b = b.limit(q.limit);
      if (q.single) b = b[q.single]();
      const { data, error } = await b;
      return { data: data ?? null, error: error ? error.message : null };
    },
    async runRpc(fn, args) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as any).rpc(fn, args);
      return { data: data ?? null, error: error ? error.message : null };
    },
    async generateImage(opts) {
      const { generatePetalImage } = await import("@/server/image-generation.server");
      return generatePetalImage(opts);
    },
    async savePicture(row) {
      const { error } = await db.from("project_pictures").insert(row as Any);
      if (error) throw new Error(error.message);
    },
  };
}
