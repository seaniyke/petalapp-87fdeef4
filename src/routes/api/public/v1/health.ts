import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "@/server/service-api.server";

export const Route = createFileRoute("/api/public/v1/health")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async () => {
        // Live AI status from the newest real AI calls (no extra AI request).
        let ai: { state: string; kind: string | null } = { state: "unknown", kind: null };
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { verdictFrom, RECENT_WINDOW_MS } = await import("@/server/ai-gateway-health.server");
          const { data } = await supabaseAdmin.from("ai_call_log").select("status, error_message, created_at")
            .gte("created_at", new Date(Date.now() - RECENT_WINDOW_MS).toISOString())
            .order("created_at", { ascending: false }).limit(5);
          const v = verdictFrom(data ?? []);
          ai = { state: v.state, kind: v.kind };
        } catch { /* keep unknown */ }
        return json({
          service: "petal-engine",
          status: ai.state === "down" ? "degraded" : "ok",
          ai,
          gateway: Boolean(process.env.LOVABLE_API_KEY),
          serviceKey: Boolean(process.env.CUSTARD_API_KEY),
          time: new Date().toISOString(),
        });
      },
    },
  },
});
