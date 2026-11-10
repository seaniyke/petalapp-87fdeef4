/**
 * Partner API — read what visitors sent to a project's site (bookings, enquiries…).
 *   GET /api/public/v1/projects/:id/records/:collection?limit=50&offset=0
 *       &where={"status":"new"}&sort=-createdAt&count=1   (same rules as the site's db.list)
 * Service key + project ownership required; read-only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, verifyApiCaller } from "@/server/service-api.server";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  where: z.string().max(4000).optional(),
  sort: z.string().max(80).optional(),
  count: z.enum(["0", "1"]).optional(),
});
const COLLECTION_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const Route = createFileRoute("/api/public/v1/projects/$id/records/$collection")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!COLLECTION_RE.test(params.collection)) return json({ error: "invalid_collection" }, 400);
        const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!q.success) return json({ error: "invalid_query", issues: q.error.issues }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "project_not_found" }, 404);
        const { getSharedBackend, listRecords } = await import("@/server/shared-backend.server");
        if (!(await getSharedBackend(params.id))) return json({ records: [], backend: false });
        const { parseWhere, parseSort, QueryError } = await import("@/server/shared-query");
        let filters, sort;
        try {
          filters = parseWhere(q.data.where ?? null);
          sort = parseSort(q.data.sort ?? null);
        } catch (e) {
          if (e instanceof QueryError) return json({ error: "invalid_query", detail: e.message }, 400);
          throw e;
        }
        try {
          const withTotal = q.data.count === "1";
          const records = await listRecords({
            projectId: params.id,
            collection: params.collection,
            scope: "all",
            limit: q.data.limit,
            offset: q.data.offset,
            filters,
            sort,
            withTotal,
          });
          return json({
            records,
            ...(withTotal ? { total: records.total } : {}),
            limit: q.data.limit,
            offset: q.data.offset,
            backend: true,
          });
        } catch (e) {
          return json({ error: "records_unavailable", detail: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
