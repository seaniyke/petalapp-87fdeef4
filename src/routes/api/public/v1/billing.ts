/**
 * GET /api/public/v1/billing — Custard AI's account with Petal: remaining
 * credit balance, credits added, total charged / refunded in the range, and
 * a per-project breakdown. `?from=&to=` (ISO) default to this month.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, serviceUserId, verifyApiCaller } from "@/server/service-api.server";
import { accountBilling } from "@/server/service-billing.server";
import { parseRange } from "@/server/service-billing-range";

export const Route = createFileRoute("/api/public/v1/billing")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        const range = parseRange(new URL(request.url));
        if ("error" in range) return json({ error: range.error }, 400);
        return json(await accountBilling(await serviceUserId(), range));
      },
    },
  },
});
