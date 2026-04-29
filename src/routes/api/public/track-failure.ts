/**
 * Public failure-ingestion endpoint.
 *
 * Receives every "Petal got a bit confused" GENERIC fallback from the client
 * (and any unmatched server-side error we choose to report) so we can rank
 * the actual silent failure modes that bypass `ai_call_log` /
 * `ai_call_outcomes` today.
 *
 * Public on purpose — no auth header is reliably present when a stream
 * blows up. The route does heavy input validation + size caps + per-IP rate
 * limiting (best-effort, in-memory) so it can't be used as a write firehose.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  surface: z.enum(["generate", "discuss", "build", "unknown"]).default("unknown"),
  raw_message: z.string().min(1).max(8000),
  tool_name: z.string().max(64).optional().nullable(),
  model: z.string().max(128).optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  stream_tail: z.string().max(2000).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
  extra: z.record(z.string(), z.any()).optional(),
});

// Tiny in-memory throttle. One Worker isolate handles maybe a few hundred
// req/s — this is plenty to keep a misbehaving client from spamming us.
const HITS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const entry = HITS.get(key);
  if (!entry || entry.resetAt < now) {
    HITS.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

/** Collapse an error string to a stable signature for grouping. */
function signatureOf(raw: string): string {
  return raw
    .replace(/\b[0-9a-f-]{16,}\b/gi, "<id>")
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export const Route = createFileRoute("/api/public/track-failure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")?.[0]?.trim() ??
          "unknown";
        if (shouldThrottle(ip)) {
          return new Response("rate_limited", { status: 429 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("bad_json", { status: 400 });
        }

        const parsed = Body.safeParse(payload);
        if (!parsed.success) {
          return new Response("bad_input", { status: 400 });
        }
        const data = parsed.data;
        const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

        try {
          await supabaseAdmin.from("pipeline_failures").insert({
            project_id: data.project_id ?? null,
            user_id: data.user_id ?? null,
            surface: data.surface,
            raw_message: data.raw_message,
            signature: signatureOf(data.raw_message),
            tool_name: data.tool_name ?? null,
            model: data.model ?? null,
            stream_tail: data.stream_tail ?? null,
            user_agent: userAgent,
            url: data.url ?? null,
            extra: data.extra ?? {},
          });
        } catch (e) {
          console.warn("[track-failure] insert failed", e);
          return new Response("db_error", { status: 500 });
        }

        return new Response("ok");
      },
      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});
