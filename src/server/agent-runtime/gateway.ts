/**
 * Railway runtime: the generation core's saved-data access, served by the
 * signed `/api/public/agent/ops` gateway on the app. Nothing here holds a
 * database key — every op is checked and scoped by the app per turn.
 */
import { createHmac } from "node:crypto";
import type { AgentIO } from "@/server/agent-io.server";
import type { AgentOp, OpResult } from "@/server/agent-ops.server";
import { createAgentDbClient, type SendDbQuery } from "@/server/agent-db-client";

export type GatewayConfig = { appOrigin: string; secret: string; turnId: string; fetcher?: typeof fetch };
export type SendOps = (ops: AgentOp[]) => Promise<OpResult[]>;

export function createOpsSender(cfg: GatewayConfig): SendOps {
  const url = new URL("/api/public/agent/ops", cfg.appOrigin).toString();
  const f = cfg.fetcher ?? fetch;
  return async (ops) => {
    const body = JSON.stringify({ turnId: cfg.turnId, ops });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", cfg.secret).update(`${timestamp}.${body}`).digest("hex");
    // One quiet retry for a network blip; the gateway's writes are idempotent
    // on the turn (commit claim, settlement) or append-only by seq.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-petal-timestamp": timestamp, "x-petal-signature": signature },
          body,
        });
        const json = (await res.json().catch(() => ({}))) as { results?: OpResult[]; error?: string };
        if (!res.ok || !json.results) throw new Error(`agent_ops_${res.status}: ${json.error ?? "no results"}`);
        return json.results;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}

async function one(send: SendOps, op: AgentOp): Promise<OpResult> {
  const [r] = await send([op]);
  return r ?? { ok: false, error: "no_result" };
}

export function createGatewayAgentIO(send: SendOps): AgentIO {
  const stopped = async (stage: string) => {
    const r = await one(send, { op: "turn.status" });
    return r.ok && (r.data as { status?: string } | undefined)?.status === "aborted"
      ? new Error(`Stopped by user before ${stage}`)
      : null;
  };
  return {
    kind: "gateway",
    async assertActive(_turnId, signal, stage) {
      if (signal?.aborted) throw new Error(`Stopped by user before ${stage}`);
      const err = await stopped(stage);
      if (err) throw err;
    },
    async claimCommit(_turnId, signal) {
      if (signal?.aborted) throw new Error("Stopped by user before saving");
      const r = await one(send, { op: "turn.claimCommit" });
      if (r.ok) return;
      // Same rule as the direct path: only an explicit Stop blocks; an
      // earlier pass having committed lets the build proceed.
      const err = await stopped("saving");
      if (err) throw err;
    },
    async checkBalance(_userId, amount) {
      const r = await one(send, { op: "credits.check", amount });
      if (!r.ok) return { ok: false, reason: "internal_error" };
      return (r.data as { enough?: boolean }).enough ? { ok: true } : { ok: false, reason: "insufficient_credits" };
    },
    async settleCharge(a) {
      const r = await one(send, { op: "credits.settle", amount: a.amount, metadata: a.metadata });
      if (!r.ok) throw new Error(r.error);
      const d = r.data as { charged: number; shortfall: number; idempotent: boolean };
      return { charged: d.charged, shortfall: d.shortfall, idempotent: d.idempotent };
    },
    async replaceFiles(_projectId, files) {
      // The app side binds the save to this turn (files + revision + turn row).
      const r = await one(send, { op: "files.replace", files });
      if (!r.ok) return { error: r.error, revision: null };
      const rev = (r.data as { revision?: number | null } | undefined)?.revision;
      return { error: null, revision: rev == null ? null : Number(rev) };
    },
    async appendEvents(_turnId, events) {
      const r = await one(send, { op: "events.append", events });
      if (!r.ok) throw new Error(r.error);
    },
    async heartbeat(_turnId, lease) {
      const r = await one(send, { op: "turn.heartbeat", lease });
      return r.ok ? (((r.data as { state?: "ok" | "lost" | "terminal" } | undefined)?.state) ?? "ok") : "ok";
    },
    async finishTurn(_turnId, status, extras) {
      await one(send, { op: "turn.finish", status, errorMessage: extras.errorMessage ?? null, creditsCharged: extras.creditsCharged ?? null });
    },
    async logAiCall(row) {
      const r = await one(send, { op: "ai.log", row });
      return r.ok ? ((r.data as { id?: string } | undefined)?.id ?? null) : null;
    },
    async updateAiCall(id, patch) {
      await one(send, { op: "ai.update", id, patch });
    },
    async readBlueprint() {
      const r = await one(send, { op: "blueprint.read" });
      return r.ok ? ((r.data as Record<string, unknown> | null) ?? null) : null;
    },
    async saveBlueprint(_projectId, columns, blueprint) {
      await one(send, { op: "blueprint.save", columns, blueprint });
    },
    async generateImage(opts) {
      // Ownership is decided by the app from the turn, not sent from here.
      const r = await one(send, {
        op: "images.generate",
        prompt: opts.prompt,
        aspectRatio: opts.aspectRatio,
        cacheKey: opts.cacheKey,
      });
      if (!r.ok) throw new Error(r.error);
      return r.data as { url: string; cached: boolean };
    },

  };
}

/** Stand-in for the admin database client, backed by the gateway. */
export function createGatewayDb(send: SendOps) {
  const sendQuery: SendDbQuery = async (q) => {
    const r = await one(send, q);
    return r.ok ? { data: r.data ?? null, error: null } : { data: null, error: { message: r.error } };
  };
  const base = createAgentDbClient(sendQuery);
  return {
    ...base,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const r = await one(send, { op: "db.rpc", fn, args });
      return r.ok ? { data: r.data ?? null, error: null } : { data: null, error: { message: r.error } };
    },
  };
}
