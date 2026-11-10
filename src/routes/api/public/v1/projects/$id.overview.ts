/**
 * Partner API — dashboard overview for one project.
 *   GET /api/public/v1/projects/:id/overview
 * Service key + project ownership required; read-only, counts only (no visitor content).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json, loadOwnedProject, preflight, verifyApiCaller } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/overview")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const { buildPartnerOverview } = await import("@/server/partner-overview.server");
        try {
          const overview = await buildPartnerOverview(params.id);
          return overview ? json(overview) : json({ error: "not_found" }, 404);
        } catch (e) {
          return json({ error: "overview_unavailable", detail: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
