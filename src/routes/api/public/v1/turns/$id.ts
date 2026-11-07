import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, serviceUserId, verifyServiceKey } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/turns/$id")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_turn_id" }, 400);
        const owner = await serviceUserId();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("turns")
          .select(
            "id, project_id, user_id, status, progress_label, error_message, credits_charged, base_revision, committed_revision, started_at, ended_at, last_seq",
          )
          .eq("id", params.id)
          .maybeSingle();
        if (!data || data.user_id !== owner) return json({ error: "not_found" }, 404);
        const { user_id: _omit, ...turn } = data;
        const { previewUrlFor, previewFields } = await import("@/server/service-api.server");
        const url = data.status === "succeeded" ? await previewUrlFor(data.project_id, data.id) : null;
        return json({ turn: { ...turn, ...previewFields(url) }, ...previewFields(url) });
      },
    },
  },
});
