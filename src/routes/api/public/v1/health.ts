import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "@/server/service-api.server";

export const Route = createFileRoute("/api/public/v1/health")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async () =>
        json({
          service: "petal-engine",
          status: "ok",
          gateway: Boolean(process.env.LOVABLE_API_KEY),
          serviceKey: Boolean(process.env.CUSTARD_API_KEY),
          time: new Date().toISOString(),
        }),
    },
  },
});
