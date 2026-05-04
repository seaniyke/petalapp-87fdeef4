/**
 * Server-owned turn lifecycle + event log.
 *
 * Why this exists: a Petal build can run for 30–60s. If the user closes the
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

type TurnStatus = "running" | "succeeded" | "failed" | "aborted";

type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

function getAdminClient(): AdminClient | null {
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
}): Promise<TurnRecorderHandle> {
  const client = getAdminClient();
  const turnId = crypto.randomUUID();

  if (!client) {
    return makeNoop(turnId);
  }

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
      await client!.from("turn_events").insert(
        batch.map((e) => ({
          turn_id: turnId,
          seq: e.seq,
          kind: e.kind,
          payload: (e.payload ?? {}) as Database["public"]["Tables"]["turn_events"]["Insert"]["payload"],
        })),
      );
      // Update last_seq so resumers know how far we got even without realtime.
      const lastSeq = batch[batch.length - 1].seq;
      await client!.from("turns").update({ last_seq: lastSeq }).eq("id", turnId);
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
        await client!
          .from("turns")
          .update({
            status,
            ended_at: new Date().toISOString(),
            error_message: extras?.errorMessage ?? null,
            credits_charged: extras?.creditsCharged ?? null,
          })
          .eq("id", turnId);
      } catch (e) {
        console.warn("[turn-recorder] finish update failed:", (e as Error).message);
      }
    },
  };
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
