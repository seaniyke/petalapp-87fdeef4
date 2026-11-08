/**
 * Partner API — instant subdomain for a project.
 *   GET    /api/public/v1/projects/:id/subdomain?slug=…   availability
 *   POST   /api/public/v1/projects/:id/subdomain          { slug } → claim
 *   DELETE /api/public/v1/projects/:id/subdomain          release
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  asServiceResponse,
  json,
  loadOwnedProject,
  preflight,
  serviceUserId,
  verifyServiceKey,
} from "@/server/service-api.server";

async function guard(request: Request, projectId: string) {
  const denied = verifyServiceKey(request);
  if (denied) return denied;
  if (!(await loadOwnedProject(projectId))) return json({ error: "project_not_found" }, 404);
  return null;
}

export const Route = createFileRoute("/api/public/v1/projects/$id/subdomain")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const slug = new URL(request.url).searchParams.get("slug") ?? "";
        const { subdomainHandlers } = await import("@/routes/api/subdomain");
        return asServiceResponse(await subdomainHandlers.check(await serviceUserId(), { projectId: params.id, slug }));
      },
      POST: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const { subdomainHandlers } = await import("@/routes/api/subdomain");
        return asServiceResponse(
          await subdomainHandlers.claim(await serviceUserId(), { slug: body.slug ?? body.subdomain, projectId: params.id }),
        );
      },
      DELETE: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const { subdomainHandlers } = await import("@/routes/api/subdomain");
        return asServiceResponse(await subdomainHandlers.release(await serviceUserId(), { projectId: params.id }));
      },
    },
  },
});
