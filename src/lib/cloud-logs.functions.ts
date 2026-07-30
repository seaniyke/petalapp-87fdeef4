/**
 * Cloud panel — Logs view server functions.
 *
 * Streams real logs from the project's managed backend: HTTP/API requests,
 * Postgres, Auth and server (edge) functions. Read-only; the SQL is fixed
 * per source so users can never inject their own query.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
} from "@/server/cloud-managed-client.server";
import { queryLogs } from "@/server/supabase-mgmt.server";

export type LogSource = "api" | "postgres" | "auth" | "functions";

export type LogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: string;
};

export type CloudLogsResult = {
  available: boolean;
  reason?: "NO_BACKEND" | "NOT_READY" | "ERROR";
  error?: string;
  entries: LogEntry[];
};

const Input = z.object({
  projectId: z.string().uuid(),
  source: z.enum(["api", "postgres", "auth", "functions"]).default("api"),
  minutes: z.number().int().min(5).max(1440).default(60),
  search: z.string().max(120).optional(),
});

const SQL: Record<LogSource, string> = {
  api: `select id, edge_logs.timestamp as timestamp, event_message,
          response.status_code as status_code, request.method as method, request.path as path
        from edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.response) as response
        cross join unnest(m.request) as request
        order by timestamp desc limit 100`,
  postgres: `select id, postgres_logs.timestamp as timestamp, event_message,
          parsed.error_severity as error_severity
        from postgres_logs
        cross join unnest(metadata) as m
        cross join unnest(m.parsed) as parsed
        order by timestamp desc limit 100`,
  auth: `select id, auth_logs.timestamp as timestamp, event_message,
          metadata.level as level, metadata.status as status, metadata.path as path,
          metadata.msg as msg, metadata.error as error
        from auth_logs
        cross join unnest(metadata) as metadata
        order by timestamp desc limit 100`,
  functions: `select id, function_edge_logs.timestamp as timestamp, event_message,
          response.status_code as status_code, request.method as method,
          m.execution_time_ms as execution_time_ms
        from function_edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.response) as response
        cross join unnest(m.request) as request
        order by timestamp desc limit 100`,
};

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return typeof v === "string" ? v : String(v);
}

function toMicrosDate(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && n > 0) {
    // Logflare returns microseconds since epoch.
    const ms = n > 1e14 ? Math.round(n / 1000) : n;
    return new Date(ms).toISOString();
  }
  const s = str(v);
  const d = s ? new Date(s) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function normalize(source: LogSource, row: Record<string, unknown>, i: number): LogEntry {
  const timestamp = toMicrosDate(row.timestamp);
  const id = str(row.id) ?? `${timestamp}-${i}`;
  const message = str(row.event_message) ?? str(row.msg) ?? "(no message)";

  let level: LogEntry["level"] = "info";
  const parts: string[] = [];

  if (source === "api" || source === "functions") {
    const status = Number(row.status_code);
    if (Number.isFinite(status)) {
      if (status >= 500) level = "error";
      else if (status >= 400) level = "warn";
      parts.push(String(status));
    }
    const method = str(row.method);
    if (method) parts.unshift(method);
    const path = str(row.path);
    if (path) parts.push(path);
    const ms = str(row.execution_time_ms);
    if (ms) parts.push(`${ms}ms`);
  } else if (source === "postgres") {
    const sev = (str(row.error_severity) ?? "").toUpperCase();
    if (sev.includes("ERROR") || sev.includes("FATAL") || sev.includes("PANIC")) level = "error";
    else if (sev.includes("WARN")) level = "warn";
    if (sev) parts.push(sev);
  } else {
    const lvl = (str(row.level) ?? "").toLowerCase();
    if (lvl.includes("error") || row.error) level = "error";
    else if (lvl.includes("warn")) level = "warn";
    const status = str(row.status);
    if (status) parts.push(status);
    const path = str(row.path);
    if (path) parts.push(path);
    const err = str(row.error);
    if (err) parts.push(err);
  }

  return { id, timestamp, level, message, meta: parts.length ? parts.join(" · ") : undefined };
}

export const getProjectLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CloudLogsResult> => {
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
        entries: [],
      };
    }
    if (!info.ref) return { available: false, reason: "NOT_READY", entries: [] };

    try {
      const rows = await queryLogs(info.ref, SQL[data.source], { minutes: data.minutes });
      let entries = rows.map((r, i) => normalize(data.source, r, i));
      const needle = data.search?.trim().toLowerCase();
      if (needle) {
        entries = entries.filter(
          (e) =>
            e.message.toLowerCase().includes(needle) ||
            (e.meta ?? "").toLowerCase().includes(needle),
        );
      }
      return { available: true, entries };
    } catch (e) {
      return {
        available: true,
        reason: "ERROR",
        error: e instanceof Error ? e.message.slice(0, 300) : "Could not load logs",
        entries: [],
      };
    }
  });
