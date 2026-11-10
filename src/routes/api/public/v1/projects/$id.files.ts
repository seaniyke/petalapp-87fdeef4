import { createFileRoute } from "@tanstack/react-router";
import {
  json,
  loadOwnedProject,
  loadProjectFiles,
  preflight,
  verifyApiCaller,
} from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/files")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const project = await loadOwnedProject(params.id, request);
        if (!project) return json({ error: "not_found" }, 404);
        const files = await loadProjectFiles(params.id);
        const path = new URL(request.url).searchParams.get("path");
        if (path) {
          const f = files.find((x) => x.path === path);
          return f ? json({ revision: project.revision, file: f }) : json({ error: "file_not_found" }, 404);
        }
        return json({ revision: project.revision, files });
      },
    },
  },
});
