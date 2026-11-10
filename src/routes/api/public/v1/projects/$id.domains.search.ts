/** GET /api/public/v1/projects/:id/domains/search?q=brand → { query, results: [...] } */
import { createFileRoute } from "@tanstack/react-router";
import { json, loadOwnedProject, preflight, verifyApiCaller } from "@/server/service-api.server";

export const Route = createFileRoute("/api/public/v1/projects/$id/domains/search")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "project_not_found" }, 404);
        const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 253);
        if (!q) return json({ error: "missing_query" }, 400);
        const { partnerSearch } = await import("@/server/partner-domains.server");
        try {
          return json({ query: q, results: await partnerSearch(q) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "search_failed";
          return json({ error: /letters, numbers/.test(msg) ? "invalid_name" : "registrar_error", message: msg }, /letters, numbers/.test(msg) ? 400 : 502);
        }
      },
    },
  },
});
