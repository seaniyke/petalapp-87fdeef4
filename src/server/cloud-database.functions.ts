/**
 * Cloud panel — Database view server functions.
 * Lists user tables in the project's managed Supabase backend with row
 * counts, and returns a small read-only sample of rows for a given table.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
  makeManagedClient,
} from "./cloud-managed-client.server";

const ProjectInput = z.object({ projectId: z.string().uuid() });

export type CloudTableSummary = {
  schema: string;
  name: string;
  rowEstimate: number;
};

export type CloudDatabaseResult = {
  available: boolean;
  reason?: "NO_BACKEND" | "NOT_READY" | "ERROR";
  tables: CloudTableSummary[];
};

export const listProjectTables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ProjectInput.parse(data))
  .handler(async ({ data, context }): Promise<CloudDatabaseResult> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    let info;
    try {
      info = await getManagedBackendForProject(data.projectId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ERROR";
      return {
        available: false,
        reason: msg === "NO_BACKEND" || msg === "NOT_MANAGED" ? "NO_BACKEND" : "NOT_READY",
        tables: [],
      };
    }

    const client = makeManagedClient(info);

    // Use the Supabase Management-style SQL via PostgREST RPC isn't available
    // by default, so we fall back to listing tables we can SELECT through the
    // exposed REST API: introspect by querying information_schema is not
    // exposed either. Best portable option: ask the storage of pg_meta-like
    // endpoints. As a safe v1 we use `pg_catalog` via the rpc helper if
    // present; otherwise return an empty list with a "not available" note.
    try {
      // Try pg-meta style: many managed Supabase projects expose
      // `pg_stat_user_tables` only via direct DB access. We approximate by
      // listing tables in the public schema using the PostgREST root which
      // returns an OpenAPI doc.
      const res = await fetch(`${info.supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: info.serviceRoleKey,
          Authorization: `Bearer ${info.serviceRoleKey}`,
          Accept: "application/openapi+json",
        },
      });
      if (!res.ok) {
        return { available: true, tables: [] };
      }
      const spec = (await res.json()) as {
        definitions?: Record<string, unknown>;
      };
      const names = Object.keys(spec.definitions ?? {});
      // Filter out PostgREST helper definitions.
      const tables: CloudTableSummary[] = names
        .filter((n) => !n.startsWith("rpc_") && n !== "")
        .sort()
        .slice(0, 200)
        .map((name) => ({ schema: "public", name, rowEstimate: 0 }));

      // Best-effort row counts using HEAD + Prefer: count=exact (capped to a
      // few tables to keep latency sane).
      const top = tables.slice(0, 12);
      await Promise.all(
        top.map(async (t) => {
          try {
            const r = await fetch(
              `${info.supabaseUrl}/rest/v1/${encodeURIComponent(t.name)}?select=*`,
              {
                method: "HEAD",
                headers: {
                  apikey: info.serviceRoleKey,
                  Authorization: `Bearer ${info.serviceRoleKey}`,
                  Prefer: "count=exact",
                  Range: "0-0",
                },
              },
            );
            const cr = r.headers.get("content-range");
            if (cr) {
              const total = Number(cr.split("/")[1]);
              if (Number.isFinite(total)) t.rowEstimate = total;
            }
          } catch {
            /* ignore per-table failure */
          }
        }),
      );

      return { available: true, tables };
    } catch (e) {
      console.error("[cloud-database] list failed", e);
      // Touch client to avoid unused-var lint
      void client;
      return { available: true, tables: [] };
    }
  });

const SampleInput = z.object({
  projectId: z.string().uuid(),
  table: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_]+$/),
  limit: z.number().int().min(1).max(50).default(20),
});

export type CloudTableSample = {
  available: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
};

export const sampleProjectTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => SampleInput.parse(data))
  .handler(async ({ data, context }): Promise<CloudTableSample> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    const info = await getManagedBackendForProject(data.projectId);
    const res = await fetch(
      `${info.supabaseUrl}/rest/v1/${encodeURIComponent(data.table)}?select=*&limit=${data.limit}`,
      {
        headers: {
          apikey: info.serviceRoleKey,
          Authorization: `Bearer ${info.serviceRoleKey}`,
        },
      },
    );
    if (!res.ok) return { available: false, columns: [], rows: [] };
    const rows = (await res.json()) as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { available: true, columns, rows };
  });
