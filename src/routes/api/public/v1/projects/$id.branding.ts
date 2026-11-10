/**
 * Partner API — "Powered by Custard AI" badge.
 *   GET  /api/public/v1/projects/:id/branding  → { badge: "shown"|"removed", priceUsd }
 *   POST /api/public/v1/projects/:id/branding  { "removeBadge": true }
 *        Charges $2.00 once (Petal credits on the partner account), then ships
 *        the live site again without the badge. Repeat calls are free.
 * Service key + project ownership required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, serviceUserId, triggerProjectBuild, verifyApiCaller } from "@/server/service-api.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({ removeBadge: z.literal(true) });

export const Route = createFileRoute("/api/public/v1/projects/$id/branding")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const { badgeRemovalStatus, PARTNER_BADGE_REMOVAL_USD } = await import("@/server/partner-badge.server");
        const { removed } = await badgeRemovalStatus(params.id);
        return json({ badge: removed ? "removed" : "shown", priceUsd: PARTNER_BADGE_REMOVAL_USD });
      },
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const body = Body.safeParse(await request.json().catch(() => null));
        if (!body.success) return json({ error: "invalid_body", expected: { removeBadge: true } }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const { removePartnerBadge } = await import("@/server/partner-badge.server");
        const out = await removePartnerBadge(params.id, await serviceUserId());
        if (!out.ok) return json({ error: out.error }, out.status);
        const build = await triggerProjectBuild(new URL(request.url).origin, params.id, { reship: true });
        return json({
          badge: "removed",
          chargedUsd: out.usd,
          chargedCredits: out.credits,
          alreadyRemoved: out.alreadyRemoved,
          buildId: build.ok ? build.buildId : null,
          reship: build.ok ? build.status : `not_started:${build.error}`,
        });
      },
    },
  },
});
