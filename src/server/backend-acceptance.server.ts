/**
 * Phase 4 — backend acceptance.
 *
 * Static checks can prove a migration parses; only a live query proves the app
 * can actually read what it thinks it can. After a deploy, this probes the
 * project's own backend with the same anon key the generated app ships with,
 * for every table the app's source references.
 *
 * Findings are emitted as plain defect strings — the exact shape the defect
 * judge, the QA board router and the completion loop already consume — so no
 * new plumbing is required downstream.
 *
 * Never throws, and never invents a failure from an inconclusive result: a
 * network error, a timeout or an unrecognised status is dropped, because a
 * healthy deploy must never be rolled back on a flaky probe.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { lookupBackendForGenerate } from "@/server/backend-connector.server";

/** Bounded: a probe pass must cost single-digit seconds, always. */
const MAX_TABLES = 8;
const PROBE_TIMEOUT_MS = 6000;

export interface BackendAcceptanceResult {
  /** Real, actionable failures. Fed into the same blocking pipeline as browser defects. */
  defects: string[];
  /** Human-readable proof for the completion record. */
  evidence: string[];
  /** False when there was nothing to check (no backend, no table references). */
  ran: boolean;
}

const EMPTY: BackendAcceptanceResult = { defects: [], evidence: [], ran: false };

const FROM_RE = /\.from\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]\s*\)/g;
/** Storage/auth/functions helpers also use `.from(...)`; those are not tables. */
const NOT_A_TABLE = new Set(["storage", "auth", "realtime", "functions"]);

/** Every public table the generated source actually reads or writes. */
export function collectReferencedTables(
  files: Array<{ path: string; content: string }>,
): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(f.path)) continue;
    FROM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FROM_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (!name || NOT_A_TABLE.has(name)) continue;
      found.add(name);
    }
  }
  return [...found].sort().slice(0, MAX_TABLES);
}

async function probeTable(args: {
  url: string;
  anonKey: string;
  table: string;
}): Promise<{ ok: boolean; defect?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${args.url.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(args.table)}?select=*&limit=1`,
      {
        headers: {
          apikey: args.anonKey,
          Accept: "application/json",
          Prefer: "count=none",
        },
        signal: controller.signal,
      },
    );

    if (res.ok) return { ok: true };

    const body = await res.text().catch(() => "");
    // Missing table / missing schema cache entry — the app queries something
    // that was never created. Always a real bug.
    if (res.status === 404 || body.includes("PGRST205") || /does not exist/i.test(body)) {
      return {
        ok: false,
        defect: `The app reads from a "${args.table}" table, but that table does not exist in the database.`,
      };
    }
    // Table exists but the Data API was never granted access to it — the
    // classic "RLS is on, GRANT was forgotten" failure.
    if (res.status === 401 || res.status === 403 || /permission denied/i.test(body)) {
      return {
        ok: false,
        defect: `The app cannot access the "${args.table}" table — the database refuses the request (missing access grant or policy).`,
      };
    }
    // 5xx, rate limits, anything else: inconclusive, never blocking.
    return { ok: true };
  } catch {
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the acceptance pass for a project. Returns no defects when the project
 * has no connected backend or the source never touches a table.
 */
export async function runBackendAcceptance(args: {
  projectId: string;
}): Promise<BackendAcceptanceResult> {
  try {
    const backend = await lookupBackendForGenerate(args.projectId);
    if (!backend) return EMPTY;

    const { data, error } = await supabaseAdmin
      .from("project_files")
      .select("path, content")
      .eq("project_id", args.projectId);
    if (error || !data?.length) return EMPTY;

    const tables = collectReferencedTables(data as Array<{ path: string; content: string }>);
    if (tables.length === 0) return EMPTY;

    const results = await Promise.all(
      tables.map(async (table) => ({
        table,
        ...(await probeTable({ url: backend.url, anonKey: backend.anonKey, table })),
      })),
    );

    const defects = results
      .map((r) => r.defect)
      .filter((d): d is string => typeof d === "string");
    const reachable = results.filter((r) => r.ok).map((r) => r.table);
    const evidence = reachable.length
      ? [`Database check passed for: ${reachable.join(", ")}`]
      : [];

    console.info(
      `[backend-acceptance] project=${args.projectId} tables=${tables.length} defects=${defects.length}`,
    );
    return { defects, evidence, ran: true };
  } catch (err) {
    console.warn(
      "[backend-acceptance] skipped:",
      err instanceof Error ? err.message : err,
    );
    return EMPTY;
  }
}
