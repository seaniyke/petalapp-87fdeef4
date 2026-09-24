import { currentTurnContext } from "@/server/turn-context.server";
/**
 * Server-owned turn lifecycle + event log.
 *
 * Why this exists: a Kimble build can run for 30–60s. If the user closes the
 * tab/phone, the SSE connection dies — but we want the pipeline to keep
 * running and the returning client to pick up *exactly* where it left off.
 *
 * This module is the single source of truth for that:
 *   1. `startTurn()` — INSERT a row in `public.turns` (status='running'),
 *      returns the `turnId` so the API handler can announce it as the very
 *      first SSE event the client sees.
 *   2. `recordEvent()` — append an event to `public.turn_events`. Calls are
 *      batched (200ms / 32 events) so we don't add a round-trip per token.
 *      Realtime is enabled on the table so a reconnecting client gets new
 *      events live.
 *   3. `finishTurn()` — UPDATE the `turns` row with the terminal status and
 *      flush any in-flight events. Idempotent and safe in `finally`.
 *
 * Failures are swallowed: turn tracking must never break a build.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type TurnStatus = "running" | "awaiting_credits" | "succeeded" | "failed" | "aborted";

type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

function getAdminClient(): AdminClient | null {
  // Railway runtime: no admin key; use the turn's gateway-scoped stand-in.
  const ctxDb = currentTurnContext().agentDb;
  if (ctxDb) return ctxDb as never;
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type TurnRecorderHandle = {
  turnId: string;
  /** Append one event to turn_events. Fire-and-forget; batched. */
  record: (kind: string, payload: unknown) => void;
  /** Mark the turn terminal and flush any pending events. */
  finish: (
    status: Exclude<TurnStatus, "running">,
    extras?: { errorMessage?: string | null; creditsCharged?: number | null },
  ) => Promise<void>;
};

/**
 * Open a new turn row and return a handle for appending events + finishing.
 * Returns a no-op recorder if the service-role key isn't configured (so
 * dev/preview without secrets still works).
 */
export async function startTurn(opts: {
  projectId: string;
  userId: string;
  /** Client-minted id (UUID). Lets the phone persist a resumable handle
   *  before the request goes out, and makes a retried send dedupe instead
   *  of double-building. */
  turnId?: string;
  /** The row already exists (opened by the durable-agent ingress). Record
   *  into it instead of inserting a second one. */
  attach?: boolean;
  /** Where events/terminal status go. Default: direct database. */
  io?: import("@/server/agent-io.server").AgentIO;
}): Promise<TurnRecorderHandle> {
  const client = getAdminClient();
  const turnId = opts.turnId ?? crypto.randomUUID();

  if (!client) {
    return makeNoop(turnId);
  }

  if (!opts.attach) {
    try {
      await client.from("turns").insert({
        id: turnId,
        project_id: opts.projectId,
        user_id: opts.userId,
        status: "running",
      });
    } catch (e) {
      console.warn("[turn-recorder] startTurn insert failed:", (e as Error).message);
      return makeNoop(turnId);
    }
  }

  let resolvedIO: import("@/server/agent-io.server").AgentIO | null = opts.io ?? null;
  const io = () => {
    if (!resolvedIO) throw new Error("agent io not ready");
    return resolvedIO;
  };
  if (!resolvedIO) resolvedIO = (await import("@/server/agent-io.server")).agentIO();

  let seq = 0;
  let queue: Array<{ seq: number; kind: string; payload: unknown }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finishing = false;

  const FLUSH_INTERVAL_MS = 200;
  const FLUSH_BATCH = 32;

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      await io().appendEvents(turnId, batch);
    } catch (e) {
      console.warn("[turn-recorder] flush failed:", (e as Error).message);
    }
  }

  function schedule() {
    if (timer || finishing) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }

  return {
    turnId,
    record(kind, payload) {
      seq += 1;
      queue.push({ seq, kind, payload });
      if (queue.length >= FLUSH_BATCH) {
        void flush();
      } else {
        schedule();
      }
    },
    async finish(status, extras) {
      finishing = true;
      try {
        await flush();
      } catch {
        /* swallow */
      }
      try {
        await io().finishTurn(turnId, status, extras ?? {});
      } catch (e) {
        console.warn("[turn-recorder] finish update failed:", (e as Error).message);
      }
    },
  };
}

/** Accept only a well-formed UUID as a client-minted turn id. Anything else
 *  is ignored (the server mints its own) so a malformed or hostile value can
 *  never target an arbitrary turn row. */
export function normalizeClientTurnId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

/** True when a turn row with this id already exists AND belongs to this
 *  user. Used to dedupe a retried send that carries a client-minted turn
 *  id: the original build keeps running and the retry attaches to it. */
export async function turnBelongsToUser(turnId: string, userId: string): Promise<boolean> {
  const client = getAdminClient();
  if (!client) return false;
  try {
    const { data } = await client
      .from("turns")
      .select("id")
      .eq("id", turnId)
      .eq("user_id", userId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

function makeNoop(turnId: string): TurnRecorderHandle {
  return {
    turnId,
    record() {
      /* no-op */
    },
    async finish() {
      /* no-op */
    },
  };
}
