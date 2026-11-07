/**
 * GET /api/public/v1/projects/:id/billing — what Petal charged for one
 * project, in credits: totals, refunds, split by build / cloud / ai / other,
 * and per-turn bills. `?from=&to=` (ISO) default to this month; `?limit=`
 * caps the turn list (max 200). `?turnId=` returns one turn's full bill.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json, loadOwnedProject, preflight, serviceUserId, verifyServiceKey } from "@/server/service-api.server";
import { projectBilling, turnBill } from "@/server/service-billing.server";
import { parseRange } from "@/server/service-billing-range";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/billing")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        const project = await loadOwnedProject(params.id);
        if (!project) return json({ error: "not_found" }, 404);
        const owner = await serviceUserId();
        const url = new URL(request.url);
        const turnId = url.searchParams.get("turnId");
        if (turnId) {
          if (!UUID.test(turnId)) return json({ error: "bad_turn_id" }, 400);
          const bill = await turnBill(owner, turnId);
          if (bill.projectId && bill.projectId !== params.id) return json({ error: "turn_not_found" }, 404);
          return json({ bill });
        }
        const range = parseRange(url);
        if ("error" in range) return json({ error: range.error }, 400);
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        return json(await projectBilling(owner, params.id, range, limit));
      },
    },
  },
});
