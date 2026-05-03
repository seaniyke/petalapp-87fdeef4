/**
 * Cloud panel — Database view server functions.
 * Lists user tables in the project's managed Supabase backend with row
 * counts, and returns a small read-only sample of rows for a given table.
 *
 * We use PostgREST's OpenAPI document (Swagger 2.0 — `definitions` map) as
 * a portable way to enumerate tables exposed via the REST API, then count
 * rows with HEAD + Prefer: count=exact for the first dozen tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
} from "./cloud-managed-client.server";
import { runQuery } from "@/server/supabase-mgmt.server";

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
  authUserCount?: number;
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

    try {
      if (!info.ref) return { available: true, tables: [] };
      const rows = await runQuery(
        info.ref,
        `select c.relname as name, greatest(c.reltuples::bigint, 0) as row_estimate
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'm')
           and c.relname not like 'pg_%'
         order by c.relname
         limit 200`,
      ) as Array<{ name?: unknown; row_estimate?: unknown }>;
      const tables: CloudTableSummary[] = rows
        .map((r) => ({
          schema: "public",
          name: String(r.name ?? ""),
          rowEstimate: Math.max(0, Number(r.row_estimate ?? 0) || 0),
        }))
        .filter((t) => t.name.length > 0);
      let authUserCount: number | undefined;
      try {
        const authRows = (await runQuery(
          info.ref,
          `select count(*)::bigint as n from auth.users`,
        )) as Array<{ n?: unknown }>;
        authUserCount = Math.max(0, Number(authRows[0]?.n ?? 0) || 0);
      } catch {
        /* non-fatal */
      }
      return { available: true, tables, authUserCount };
    } catch (e) {
      console.error("[cloud-database] list failed", e);
      return { available: true, tables: [] };
    }
  });

const SampleInput = z.object({
  projectId: z.string().uuid(),
  table: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_]+$/),
  limit: z.number().int().min(1).max(50).default(20),
});

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type CloudTableSample = {
  available: boolean;
  columns: string[];
  rows: { [k: string]: JsonValue }[];
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
    const rows = (await res.json()) as { [k: string]: JsonValue }[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { available: true, columns, rows };
  });
