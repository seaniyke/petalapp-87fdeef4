/**
 * Durable-builder data gateway (Phase 1 of the Railway move).
 *
 * The Railway builder never holds the database admin key. When generation
 * runs there, every read/write goes through one signed endpoint
 * (`POST /api/public/agent/ops`) which calls `runAgentOp` below.
 *
 * Security model:
 *  - The request is HMAC-signed with BUILDER_SHARED_SECRET (5-minute expiry,
 *    same scheme as build callbacks).
 *  - Every op is scoped to ONE turn. The turn row decides the user and the
 *    project; the caller can never name another user or project.
 *  - Only ops on the fixed list run. Writes require the turn to still be
 *    `running` (Stop wins); `turn.finish` may close it once.
 *  - Credit charges are idempotent per turn: a replayed charge returns the
 *    first ledger row instead of billing twice.
 *
 * The dispatcher is storage-agnostic (`AgentOpsStore`) so it is unit-tested
 * without a database.
 */
import { z } from "zod";
import { DbQuerySchema, DbRpcSchema, scopeDbQuery, scopeDbRpc, type ScopedQuery } from "@/server/agent-db-scope";

export type TurnRow = {
  id: string;
  user_id: string;
  project_id: string;
  status: string;
  committed_at: string | null;
};

export type FileRow = { path: string; content: string };
export type SettleResult = { charged: number; shortfall: number; ledgerId: string | null; idempotent: boolean };
export type EventRow = { seq: number; kind: string; payload?: unknown };

export interface AgentOpsStore {
  getTurn(turnId: string): Promise<TurnRow | null>;
  readFiles(projectId: string): Promise<FileRow[]>;
  replaceFiles(projectId: string, files: FileRow[]): Promise<void>;
  readMemory(projectId: string): Promise<Array<{ key: string; value: string }>>;
  readBlueprint(projectId: string): Promise<Record<string, unknown> | null>;
  saveBlueprint(projectId: string, columns: Record<string, unknown>, blueprint: Record<string, unknown>): Promise<void>;
  appendEvents(turnId: string, events: EventRow[]): Promise<void>;
  /** Worker lease + liveness (claim_turn_heartbeat). */
  heartbeat?(turnId: string, lease: string): Promise<"ok" | "lost" | "terminal">;
  /** Atomic: set committed_at only while running + uncommitted. */
  claimCommit(turnId: string): Promise<boolean>;
  finishTurn(
    turnId: string,
    status: "awaiting_credits" | "succeeded" | "failed" | "aborted",
    extras: { errorMessage?: string | null; creditsCharged?: number | null },
  ): Promise<void>;
  checkBalance(userId: string, amount: number): Promise<boolean>;
  /** settle_build_charge: idempotent on the turn id, drains available
   *  buckets and books any remainder as debt (same as the in-Worker path). */
  settle(args: { userId: string; projectId: string; turnId: string; amount: number; metadata: Record<string, unknown> }): Promise<SettleResult>;
  ledgerOwner(ledgerId: string): Promise<{ user_id: string; turn_id: string | null } | null>;
  refund(args: { userId: string; ledgerId: string; reason: string }): Promise<boolean>;
  logAiCall(row: Record<string, unknown>): Promise<string | null>;
  /** Patch only if the row belongs to this turn. Returns whether it did. */
  updateAiCall(turnId: string, id: string, patch: Record<string, unknown>): Promise<boolean>;
  /** Start compile + publish for the project (idempotent per file revision). */
  startBuild?(projectId: string, userId: string, turnId: string): Promise<boolean>;
  /** Rename a still-"Untitled project" project. Best-effort, never throws. */
  nameUntitledProject?(projectId: string): Promise<void>;
  /** Run an already-scoped table query. */
  runQuery(q: ScopedQuery): Promise<{ data: unknown; error: string | null }>;
  runRpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }>;
  /** Make + store one picture on the Worker (it holds the storage access). */
  generateImage(opts: { prompt: string; aspectRatio?: "1:1" | "16:9" | "4:3" | "3:4" | "9:16"; cacheKey?: string; scope?: { projectId?: string | null; ownerId?: string | null; turnId?: string | null } }): Promise<{ url: string; cached: boolean }>;
  savePicture(row: { project_id: string; url: string; storage_path: string | null; label: string | null; tags: string[] }): Promise<void>;
}

const Files = z
  .array(z.object({ path: z.string().min(1).max(500), content: z.string().max(2_000_000) }))
  .max(500);

export const AgentOpSchema = z.discriminatedUnion("op", [
  DbQuerySchema,
  DbRpcSchema,
  z.object({
    op: z.literal("images.generate"),
    prompt: z.string().min(1).max(4000),
    aspectRatio: z.enum(["1:1", "16:9", "4:3", "3:4", "9:16"]).optional(),
    cacheKey: z.string().max(200).optional(),
  }),
  z.object({ op: z.literal("turn.context") }),
  z.object({ op: z.literal("files.read") }),
  z.object({ op: z.literal("files.replace"), files: Files }),
  z.object({ op: z.literal("memory.read") }),
  z.object({ op: z.literal("blueprint.read") }),
  z.object({
    op: z.literal("blueprint.save"),
    columns: z
      .object({
        project_type: z.string().max(100).optional(),
        sections: z.array(z.string().max(200)).max(100).optional(),
        navigation: z.array(z.string().max(200)).max(100).optional(),
        design_language: z.string().max(2000).optional(),
        backend: z.string().max(100).optional(),
        files: z.array(z.string().max(500)).max(500).optional(),
      })
      .strip(),
    blueprint: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal("events.append"),
    events: z
      .array(z.object({ seq: z.number().int().positive(), kind: z.string().min(1).max(100), payload: z.unknown() }))
      .min(1)
      .max(64),
  }),
  z.object({ op: z.literal("turn.status") }),
  z.object({ op: z.literal("turn.heartbeat"), lease: z.string().uuid() }),
  z.object({ op: z.literal("build.start") }),
  z.object({ op: z.literal("turn.claimCommit") }),
  z.object({
    op: z.literal("turn.finish"),
    status: z.enum(["awaiting_credits", "succeeded", "failed", "aborted"]),
    errorMessage: z.string().max(2000).nullable().optional(),
    creditsCharged: z.number().min(0).max(10_000).nullable().optional(),
  }),
  z.object({ op: z.literal("credits.check"), amount: z.number().positive().max(10_000) }),
  z.object({
    op: z.literal("credits.settle"),
    amount: z.number().positive().max(10_000),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({ op: z.literal("credits.refund"), ledgerId: z.string().uuid(), reason: z.string().min(1).max(100) }),
  z.object({ op: z.literal("ai.log"), row: z.record(z.unknown()) }),
  z.object({ op: z.literal("ai.update"), id: z.string().uuid(), patch: z.record(z.unknown()) }),
  z.object({
    op: z.literal("pictures.save"),
    url: z.string().url().max(2000),
    storagePath: z.string().max(500).nullable().optional(),
    label: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
]);
export type AgentOp = z.infer<typeof AgentOpSchema>;

export const AgentOpsRequestSchema = z.object({
  turnId: z.string().uuid(),
  ops: z.array(AgentOpSchema).min(1).max(20),
});

/** Ops that change state and therefore need a still-running turn. */
const WRITES_NEED_RUNNING = new Set<AgentOp["op"]>([
  "files.replace",
  "events.append",
  "turn.claimCommit",
  "credits.settle",
  "pictures.save",
  "blueprint.save",
]);

export type OpResult = { ok: true; data?: unknown } | { ok: false; error: string };

export class AgentOpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Run a batch of ops for one turn. Stops at the first failed op. */
export async function runAgentOps(
  store: AgentOpsStore,
  turnId: string,
  ops: AgentOp[],
): Promise<OpResult[]> {
  const turn = await store.getTurn(turnId);
  if (!turn) throw new AgentOpError(404, "turn_not_found");
  const results: OpResult[] = [];
  for (const op of ops) {
    const r = await runOne(store, turn, op);
    results.push(r);
    if (!r.ok) break;
    // Keep the local view current for later ops in the same batch.
    if (op.op === "turn.claimCommit") turn.committed_at = new Date().toISOString();
    if (op.op === "turn.finish") turn.status = op.status;
  }
  return results;
}

async function runOne(store: AgentOpsStore, turn: TurnRow, op: AgentOp): Promise<OpResult> {
  if (WRITES_NEED_RUNNING.has(op.op) && turn.status !== "running") {
    // Re-read: another worker (Stop) may have changed it.
    return { ok: false, error: turn.status === "aborted" ? "turn_stopped" : "turn_not_running" };
  }
  if (WRITES_NEED_RUNNING.has(op.op)) {
    const fresh = await store.getTurn(turn.id);
    if (!fresh || fresh.status !== "running") {
      turn.status = fresh?.status ?? "missing";
      return { ok: false, error: fresh?.status === "aborted" ? "turn_stopped" : "turn_not_running" };
    }
  }
  switch (op.op) {
    case "turn.context":
      return { ok: true, data: { userId: turn.user_id, projectId: turn.project_id, status: turn.status } };
    case "turn.status": {
      const fresh = await store.getTurn(turn.id);
      return { ok: true, data: { status: fresh?.status ?? null, committed: !!fresh?.committed_at } };
    }
    case "files.read":
      return { ok: true, data: await store.readFiles(turn.project_id) };
    case "files.replace": {
      if (!turn.committed_at) return { ok: false, error: "commit_not_claimed" };
      const byPath = new Map<string, FileRow>();
      for (const f of op.files) byPath.set(f.path.trim(), { path: f.path.trim(), content: f.content });
      await store.replaceFiles(turn.project_id, [...byPath.values()]);
      return { ok: true };
    }
    case "memory.read":
      return { ok: true, data: await store.readMemory(turn.project_id) };
    case "blueprint.read":
      return { ok: true, data: await store.readBlueprint(turn.project_id) };
    case "blueprint.save":
      await store.saveBlueprint(turn.project_id, op.columns, op.blueprint);
      return { ok: true };
    case "db.query": {
      const scoped = scopeDbQuery(op, { projectId: turn.project_id, userId: turn.user_id, turnId: turn.id });
      if ("error" in scoped) return { ok: false, error: scoped.error };
      const logTable = op.table === "ai_call_log" || op.table === "pipeline_failures";
      if (op.action !== "select" && !logTable) {
        const fresh = await store.getTurn(turn.id);
        if (!fresh || fresh.status !== "running") {
          return { ok: false, error: fresh?.status === "aborted" ? "turn_stopped" : "turn_not_running" };
        }
      }
      const r = await store.runQuery(scoped);
      return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
    }
    case "db.rpc": {
      const scoped = scopeDbRpc(op, { projectId: turn.project_id, userId: turn.user_id, turnId: turn.id });
      if ("error" in scoped) return { ok: false, error: scoped.error };
      const r = await store.runRpc(scoped.fn, scoped.args);
      return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
    }
    case "images.generate": {
      const fresh = await store.getTurn(turn.id);
      if (!fresh || fresh.status !== "running") {
        return { ok: false, error: fresh?.status === "aborted" ? "turn_stopped" : "turn_not_running" };
      }
      try {
        // Ownership comes from the turn on this side — never from the caller.
        return {
          ok: true,
          data: await store.generateImage({
            prompt: op.prompt,
            aspectRatio: op.aspectRatio,
            cacheKey: op.cacheKey,
            scope: { projectId: turn.project_id, ownerId: turn.user_id, turnId: turn.id },
          }),
        };

      } catch (e) {
        return { ok: false, error: (e as Error).message.slice(0, 300) };
      }
    }
    case "turn.heartbeat":
      return { ok: true, data: { state: store.heartbeat ? await store.heartbeat(turn.id, op.lease) : "ok" } };
    case "events.append":
      await store.appendEvents(turn.id, op.events);
      return { ok: true };
    case "turn.claimCommit":
      return (await store.claimCommit(turn.id)) ? { ok: true } : { ok: false, error: "commit_lost" };
    case "turn.finish": {
      const fresh = await store.getTurn(turn.id);
      // A stopped turn stays stopped; a closed turn cannot be reopened/rewritten.
      if (!fresh || fresh.status !== "running") return { ok: false, error: "turn_not_running" };
      await store.finishTurn(turn.id, op.status, {
        errorMessage: op.errorMessage ?? null,
        creditsCharged: op.creditsCharged ?? null,
      });
      // Durable builds finish with no browser attached, so the browser-side
      // auto-title never runs. Name the project here instead (no AI call).
      if (op.status === "succeeded" && store.nameUntitledProject) {
        await store.nameUntitledProject(turn.project_id).catch(() => {});
      }
      return { ok: true };
    }
    case "credits.check":
      return { ok: true, data: { enough: await store.checkBalance(turn.user_id, op.amount) } };
    case "credits.settle": {
      if (!turn.committed_at) return { ok: false, error: "commit_not_claimed" };
      const r = await store.settle({
        userId: turn.user_id,
        projectId: turn.project_id,
        turnId: turn.id,
        amount: op.amount,
        metadata: { ...(op.metadata ?? {}), via: "agent_ops" },
      });
      return { ok: true, data: r };
    }
    case "credits.refund": {
      const owner = await store.ledgerOwner(op.ledgerId);
      if (!owner || owner.user_id !== turn.user_id || owner.turn_id !== turn.id) {
        return { ok: false, error: "ledger_not_in_turn" };
      }
      const ok = await store.refund({ userId: turn.user_id, ledgerId: op.ledgerId, reason: op.reason });
      return ok ? { ok: true } : { ok: false, error: "refund_failed" };
    }
    case "ai.log":
      // Identity fields come from the turn, never from the caller.
      return {
        ok: true,
        data: { id: await store.logAiCall({ ...op.row, user_id: turn.user_id, project_id: turn.project_id, turn_id: turn.id }) },
      };
    case "ai.update": {
      const { user_id: _u, project_id: _p, turn_id: _t, id: _i, ...patch } = op.patch;
      return (await store.updateAiCall(turn.id, op.id, patch)) ? { ok: true } : { ok: false, error: "row_not_in_turn" };
    }
    case "build.start": {
      // Only a finished, successful turn may publish — never a running,
      // failed or stopped one. The trigger itself is idempotent.
      const fresh = await store.getTurn(turn.id);
      if (fresh?.status !== "succeeded") return { ok: false, error: "turn_not_succeeded" };
      if (!store.startBuild) return { ok: false, error: "unsupported" };
      return (await store.startBuild(turn.project_id, turn.user_id, turn.id)) ? { ok: true } : { ok: false, error: "build_not_started" };
    }
    case "pictures.save":
      await store.savePicture({
        project_id: turn.project_id,
        url: op.url,
        storage_path: op.storagePath ?? null,
        label: op.label ?? null,
        tags: op.tags ?? [],
      });
      return { ok: true };
  }
}
