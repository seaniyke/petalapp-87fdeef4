/** POST /api/public/v1/projects/:id/domains/purchase { hostname, termYears?, sandbox? } */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, verifyServiceKey } from "@/server/service-api.server";

const Body = z.object({
  hostname: z.string().min(4).max(253),
  termYears: z.number().int().min(1).max(10).optional(),
  sandbox: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/v1/projects/$id/domains/purchase")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!(await loadOwnedProject(params.id))) return json({ error: "project_not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_name", issues: parsed.error.issues }, 400);
        const { partnerPurchase } = await import("@/server/partner-domains.server");
        const out = await partnerPurchase({
          projectId: params.id,
          hostname: parsed.data.hostname,
          termYears: parsed.data.termYears ?? 1,
          sandbox: parsed.data.sandbox === true,
        });
        return json(out.body, out.status);
      },
    },
  },
});
