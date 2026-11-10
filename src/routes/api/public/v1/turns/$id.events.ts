/** GET /api/public/v1/turns/$id/events?after=<seq> — replay + live-tail a turn (reconnects). */
import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, json, preflight, serviceUserId, tailTurnEvents, verifyApiCaller } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/turns/$id/events")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_turn_id" }, 400);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin.from("turns").select("user_id").eq("id", params.id).maybeSingle();
        if (!data || data.user_id !== (await serviceUserId())) return json({ error: "not_found" }, 404);
        const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? 0) || 0);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const e of tailTurnEvents(params.id, after)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: e.kind, ...e.payload, seq: e.seq })}\n\n`));
              }
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
