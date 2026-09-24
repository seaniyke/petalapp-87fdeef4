/**
 * POST /api/turns/$id/cancel — the user pressed Stop.
 * Owner-only, idempotent, scoped to exactly this turn id.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/turns/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const turnId = params.id;
        if (!UUID.test(turnId)) return new Response("Bad turn id", { status: 400 });
        const url = process.env.SUPABASE_URL;
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !pub) return new Response("Server misconfigured", { status: 500 });
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const userClient = createClient<Database>(url, pub, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: auth } },
        });
        const { data, error } = await userClient.auth.getUser();
        if (error || !data?.user) return new Response("Unauthorized", { status: 401 });
        const { requestTurnCancel } = await import("@/server/turn-cancel.server");
        const result = await requestTurnCancel(turnId, data.user.id);
        if (!result.ok) return new Response(result.code === 404 ? "Turn not found" : "Cancel failed", { status: result.code });
        return Response.json({ cancelled: result.cancelled, status: result.status });
      },
    },
  },
});
