/**
 * Partner API — read what visitors sent to a project's site (bookings, enquiries…).
 *   GET /api/public/v1/projects/:id/records/:collection?limit=50&offset=0
 * Service key + project ownership required; read-only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, verifyServiceKey } from "@/server/service-api.server";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const COLLECTION_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const Route = createFileRoute("/api/public/v1/projects/$id/records/$collection")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        if (!COLLECTION_RE.test(params.collection)) return json({ error: "invalid_collection" }, 400);
        const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!q.success) return json({ error: "invalid_query", issues: q.error.issues }, 400);
        if (!(await loadOwnedProject(params.id))) return json({ error: "project_not_found" }, 404);
        const { getSharedBackend, listRecords } = await import("@/server/shared-backend.server");
        if (!(await getSharedBackend(params.id))) return json({ records: [], backend: false });
        try {
          const records = await listRecords({
            projectId: params.id,
            collection: params.collection,
            scope: "all",
            limit: q.data.limit,
            offset: q.data.offset,
          });
          return json({ records, limit: q.data.limit, offset: q.data.offset, backend: true });
        } catch (e) {
          return json({ error: "records_unavailable", detail: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
