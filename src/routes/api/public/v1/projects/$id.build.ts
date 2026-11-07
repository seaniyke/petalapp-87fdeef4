/**
 * POST /api/public/v1/projects/:id/build — compile, test and deploy the
 * project's current code. Idempotent per code revision: asking twice for the
 * same revision returns the same build. Follow it with GET …/builds.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  json,
  loadOwnedProject,
  preflight,
  triggerProjectBuild,
  verifyServiceKey,
} from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/build")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const project = await loadOwnedProject(params.id);
        if (!project) return json({ error: "not_found" }, 404);
        const started = await triggerProjectBuild(new URL(request.url).origin, params.id);
        if (!started.ok) return json({ error: started.error }, started.status >= 400 ? started.status : 502);
        return json(
          { buildId: started.buildId, status: started.status, reused: started.reused ?? false, revision: project.revision },
          202,
        );
      },
    },
  },
});
