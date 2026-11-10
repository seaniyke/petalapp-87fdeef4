/** GET /api/public/v1/openapi.json — public API description (no secrets, no data). */
import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/server/service-api.server";
import { openApiSpec } from "@/server/openapi-spec";

export const Route = createFileRoute("/api/public/v1/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) =>
        new Response(JSON.stringify(openApiSpec(new URL(request.url).origin), null, 2), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...CORS_HEADERS },
        }),
    },
  },
});
