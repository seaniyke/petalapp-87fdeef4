/**
 * Partner API — put the latest ready build live on the project's addresses.
 *   POST /api/public/v1/projects/:id/publish
 * Service key + ownership required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json, loadOwnedProject, preflight, verifyServiceKey } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/publish")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id))) return json({ error: "not_found" }, 404);
        const { publishLatestBuild } = await import("@/server/project-publish.server");
        const r = await publishLatestBuild(params.id);
        if (!r.ok) return json({ error: r.error }, r.status);
        return json({ published: true, buildId: r.buildId, revision: r.revision, publishedAt: r.publishedAt });
      },
    },
  },
});
