/**
 * Partner API — custom domains for a project.
 *   GET    /api/public/v1/projects/:id/domains            list (refreshes purchased-domain state)
 *   POST   /api/public/v1/projects/:id/domains            { hostname } → DNS instructions
 *   POST   /api/public/v1/projects/:id/domains?action=verify|primary  { domainId }
 *   DELETE /api/public/v1/projects/:id/domains?domainId=…
 * Same logic as the signed-in /api/domains, acting as the service account.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  asServiceResponse,
  json,
  loadOwnedProject,
  preflight,
  serviceUserId,
  verifyApiCaller,
} from "@/server/service-api.server";

async function guard(request: Request, projectId: string) {
  const denied = await verifyApiCaller(request);
  if (denied) return denied;
  if (!(await loadOwnedProject(projectId, request))) return json({ error: "project_not_found" }, 404);
  return null;
}

export const Route = createFileRoute("/api/public/v1/projects/$id/domains")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const { domainHandlers } = await import("@/routes/api/domains");
        const res = await asServiceResponse(await domainHandlers.list(await serviceUserId(), { projectId: params.id }));
        if (!res.ok) return res;
        return json({ domains: await res.json() });
      },
      POST: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const action = new URL(request.url).searchParams.get("action") ?? "add";
        const { domainHandlers } = await import("@/routes/api/domains");
        const owner = await serviceUserId();
        const input = { ...body, projectId: params.id };
        if (action === "add") return asServiceResponse(await domainHandlers.add(owner, input));
        if (action === "verify") return asServiceResponse(await domainHandlers.verify(owner, input));
        if (action === "primary") return asServiceResponse(await domainHandlers.setPrimary(owner, input));
        return json({ error: "unknown_action" }, 400);
      },
      DELETE: async ({ request, params }) => {
        const stop = await guard(request, params.id);
        if (stop) return stop;
        const domainId = new URL(request.url).searchParams.get("domainId");
        const { domainHandlers } = await import("@/routes/api/domains");
        return asServiceResponse(
          await domainHandlers.remove(await serviceUserId(), { projectId: params.id, domainId }),
        );
      },
    },
  },
});
