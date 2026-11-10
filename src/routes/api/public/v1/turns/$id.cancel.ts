import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, serviceUserId, verifyApiCaller, callerCanAccessProject } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/turns/$id/cancel")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_turn_id" }, 400);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: turn } = await supabaseAdmin.from("turns").select("project_id").eq("id", params.id).maybeSingle();
        if (!turn || !(await callerCanAccessProject(request, turn.project_id))) return json({ error: "not_found" }, 404);
        const { requestTurnCancel } = await import("@/server/turn-cancel.server");
        const result = await requestTurnCancel(params.id, await serviceUserId());
        if (!result.ok) return json({ error: result.code === 404 ? "not_found" : "cancel_failed" }, result.code);
        return json({ cancelled: result.cancelled, status: result.status });
      },
    },
  },
});
