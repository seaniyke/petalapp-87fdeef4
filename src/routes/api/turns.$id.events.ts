/**
 * Resumable turn stream.
 *
 *   GET /api/turns/$id/events?after=<seq>
 *
 * Lets a returning client replay everything that happened during a build
 * after a given event sequence number, then live-tail any new events until
 * the turn reaches a terminal status (succeeded / failed / aborted).
 *
 * Why this exists: the primary `/api/generate` SSE stream is bound to a
 * single HTTP connection. When the user closes their phone, switches tabs,
 * or refreshes, that connection dies — but the build keeps running on the
 * server and continues writing events to `public.turn_events`. This endpoint
 * is how the client picks up exactly where it left off.
 *
 * Tailing strategy: short-poll `turn_events` every 800ms via the indexed
 * (turn_id, seq) lookup. We don't use Postgres LISTEN because we run in a
 * Cloudflare Worker (no long-lived raw connections). Realtime via the
 * Supabase JS client would also work but adds a WS dependency we don't
 * need — a small SELECT every 800ms is plenty for a 30–60s build.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type TurnRow = {
  id: string;
  user_id: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  last_seq: number;
};

type EventRow = {
  seq: number;
  kind: string;
  payload: unknown;
};

const POLL_INTERVAL_MS = 800;
/** Hard ceiling on how long the resume stream stays open even if nothing
 *  arrives. Build pipeline timeout is ~4min; we allow 6 to be safe. */
const MAX_STREAM_MS = 6 * 60_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function sse(type: string, payload: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

export const Route = createFileRoute("/api/turns/$id/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const turnId = params.id;
        const url = new URL(request.url);
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0;

        // Auth: caller must be signed in AND must own the turn (or be admin).
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SERVICE_ROLE) {
          return new Response("Server misconfigured", { status: 500 });
        }
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: auth } },
        });
        const { data: userRes, error: userErr } = await userClient.auth.getUser();
        if (userErr || !userRes?.user) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Use service-role to read turns + events (RLS is owner-only on
        // turns; we already checked ownership below explicitly).
        const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: turnRow, error: turnErr } = await admin
          .from("turns")
          .select("id,user_id,status,last_seq")
          .eq("id", turnId)
          .maybeSingle();

        if (turnErr) {
          return new Response("Lookup failed", { status: 500 });
        }
        if (!turnRow) {
          return new Response("Turn not found", { status: 404 });
        }
        const row = turnRow as unknown as TurnRow;
        if (row.user_id !== userRes.user.id) {
          // Could also allow admin; for now keep strict.
          return new Response("Forbidden", { status: 403 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const startedAt = Date.now();
            let lastSeqSent = after;
            let closed = false;
            let terminal = false;

            function safeEnqueue(text: string) {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(text));
              } catch {
                closed = true;
              }
            }

            // Tell the client which turn this stream belongs to + replay
            // their starting position so they can no-op duplicates safely.
            safeEnqueue(sse("resume_start", { turnId, after }));

            try {
              // 1) Initial replay of everything they missed.
              const { data: pastEvents } = await admin
                .from("turn_events")
                .select("seq,kind,payload")
                .eq("turn_id", turnId)
                .gt("seq", after)
                .order("seq", { ascending: true });

              if (pastEvents) {
                for (const evt of pastEvents as unknown as EventRow[]) {
                  const payload =
                    evt.payload && typeof evt.payload === "object"
                      ? (evt.payload as Record<string, unknown>)
                      : {};
                  safeEnqueue(sse(evt.kind, payload));
                  lastSeqSent = evt.seq;
                }
              }

              // 2) If the turn already ended before/while we replayed, we
              //    can close right away — no need to tail.
              if (row.status !== "running") {
                safeEnqueue(sse("done", { status: row.status }));
                return;
              }

              // 3) Live tail until terminal or timeout.
              while (!closed && !terminal && Date.now() - startedAt < MAX_STREAM_MS) {
                if (request.signal.aborted) break;
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                if (request.signal.aborted || closed) break;

                const { data: newEvents } = await admin
                  .from("turn_events")
                  .select("seq,kind,payload")
                  .eq("turn_id", turnId)
                  .gt("seq", lastSeqSent)
                  .order("seq", { ascending: true })
                  .limit(200);

                if (newEvents && newEvents.length > 0) {
                  for (const evt of newEvents as unknown as EventRow[]) {
                    const payload =
                      evt.payload && typeof evt.payload === "object"
                        ? (evt.payload as Record<string, unknown>)
                        : {};
                    safeEnqueue(sse(evt.kind, payload));
                    lastSeqSent = evt.seq;
                    if (evt.kind === "done") terminal = true;
                  }
                }

                // Also re-read turn status so we can close even if the
                // pipeline crashed without emitting a `done` event.
                if (!terminal) {
                  const { data: t } = await admin
                    .from("turns")
                    .select("status")
                    .eq("id", turnId)
                    .maybeSingle();
                  const status = (t?.status ?? "running") as TurnRow["status"];
                  if (status !== "running") {
                    safeEnqueue(sse("done", { status }));
                    terminal = true;
                  }
                }
              }
            } finally {
              if (!terminal) {
                // Hit the cap without seeing an end. Tell the client so it
                // can decide whether to re-poll or surface an error.
                safeEnqueue(sse("resume_timeout", {}));
              }
              closed = true;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
          cancel() {
            // Client disconnected; loop will exit on next signal check.
          },
        });

        return new Response(stream, { status: 200, headers: SSE_HEADERS });
      },
    },
  },
});
