import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, serviceUserId, verifyApiCaller, callerCanAccessProject } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/turns/$id")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
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
        if (!(await callerCanAccessProject(request, data.project_id))) return json({ error: "not_found" }, 404);
        const { user_id: _omit, ...turn } = data;
        const { previewUrlFor, previewFields } = await import("@/server/service-api.server");
        const { turnBill } = await import("@/server/service-billing.server");
        // Latest human-readable step while running (progress_label is rarely set).
        const latestStatus = async (): Promise<string | null> => {
          if (data.status !== "running") return null;
          const { data: ev } = await supabaseAdmin
            .from("turn_events")
            .select("payload")
            .eq("turn_id", data.id)
            .eq("kind", "status")
            .order("seq", { ascending: false })
            .limit(1)
            .maybeSingle();
          const msg = (ev?.payload as { message?: unknown } | null)?.message;
          return typeof msg === "string" ? msg.slice(0, 200) : null;
        };
        const [url, billing, status] = await Promise.all([
          data.status === "succeeded" ? previewUrlFor(data.project_id, data.id) : Promise.resolve(null),
          turnBill(owner, data.id),
          data.progress_label ? Promise.resolve(data.progress_label) : latestStatus().catch(() => null),
        ]);
        return json({
          turn: { ...turn, ...previewFields(url) },
          progress: status,
          creditsUsed: billing.net,
          billing,
          ...previewFields(url),
        });
      },
    },
  },
});
