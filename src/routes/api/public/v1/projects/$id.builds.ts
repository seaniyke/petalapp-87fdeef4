/**
 * GET /api/public/v1/projects/:id/builds — recent compile/test/deploy runs.
 * `?buildId=<uuid>` returns one build. A ready build carries `deploymentUrl`.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getProjectBuild,
  json,
  listProjectBuilds,
  loadOwnedProject,
  preflight,
  verifyServiceKey,
} from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/builds")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const project = await loadOwnedProject(params.id);
        if (!project) return json({ error: "not_found" }, 404);
        const url = new URL(request.url);
        const buildId = url.searchParams.get("buildId");
        if (buildId) {
          if (!UUID.test(buildId)) return json({ error: "bad_build_id" }, 400);
          const build = await getProjectBuild(params.id, buildId);
          return build ? json({ build }) : json({ error: "build_not_found" }, 404);
        }
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10) || 10));
        const builds = await listProjectBuilds(params.id, limit);
        const live = builds.find((b) => b.status === "ready") ?? null;
        return json({ revision: project.revision, latest: builds[0] ?? null, live, builds });
      },
    },
  },
});
