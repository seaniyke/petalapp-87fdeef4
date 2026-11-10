/** DELETE /api/public/v1/keys/$id — revoke a developer key (master key only). */
import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, requireServiceCaller, verifyApiCaller } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/keys/$id")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      DELETE: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        const notService = requireServiceCaller(request);
        if (notService) return notService;
        if (!UUID.test(params.id)) return json({ error: "bad_key_id" }, 400);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("developer_api_keys")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", params.id)
          .is("revoked_at", null)
          .select("id, revoked_at")
          .maybeSingle();
        if (error) return json({ error: "revoke_failed" }, 500);
        if (!data) return json({ error: "not_found_or_already_revoked" }, 404);
        return json({ revoked: true, key: data });
      },
    },
  },
});
