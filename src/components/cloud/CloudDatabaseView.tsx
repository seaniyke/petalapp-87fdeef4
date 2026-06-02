/**
 * CloudDatabaseView — lists tables in the project's managed backend with
 * row-count estimates. Tap a table to see a small read-only sample.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Loader2,
  ChevronRight,
  Table2,
  History,
  CheckCircle2,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listProjectTables,
  sampleProjectTable,
  type CloudTableSummary,
} from "@/lib/cloud-database.functions";
import {
  getMigrationHistory,
  runProjectMigrations,
} from "@/lib/managed-migrations.functions";
import { CloudEmptyState } from "./CloudEmptyState";

type Props = { projectId: string };

export function CloudDatabaseView({ projectId }: Props) {
  const fnList = useServerFn(listProjectTables);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<CloudTableSummary[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [authUserCount, setAuthUserCount] = useState<number | undefined>(undefined);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fnList({ data: { projectId } })
      .then((res) => {
        if (cancelled) return;
        setAvailable(res.available);
        setTables(res.tables);
        setAuthUserCount(res.authUserCount);
      })
      .catch(() => !cancelled && setAvailable(false))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fnList, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!available) {
    return (
      <div className="p-4">
        <CloudEmptyState
          title="No backend yet"
          description="Enable Petal Cloud for this project to see your database tables here."
        />
      </div>
    );
  }

  if (active) {
    return (
      <CloudTableSample
        projectId={projectId}
        table={active}
        onBack={() => setActive(null)}
      />
    );
  }

  const hasUsers = (authUserCount ?? 0) > 0;
  const noTables = tables && tables.length === 0;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Database className="h-4 w-4" />
        <span>{tables?.length ?? 0} tables</span>
        {hasUsers && (
          <span className="ml-auto rounded-full bg-muted/60 px-2 py-0.5 text-xs">
            {authUserCount} signed-up {authUserCount === 1 ? "user" : "users"} in Auth
          </span>
        )}
      </div>
      {noTables && (
        <CloudEmptyState
          title={hasUsers ? "Auth is live — no app tables yet" : "No tables yet"}
          description={
            hasUsers
              ? `Your backend is running and ${authUserCount} ${authUserCount === 1 ? "person has" : "people have"} signed up (stored privately in Auth). You haven't asked Petal to create any app tables yet — try: 'add a profiles table linked to auth users', or 'add a listings table with title, price and location'.`
              : "Your backend is running but no app tables have been created. Ask Petal in chat — e.g. 'add a recipes table with title and ingredients'."
          }
        />
      )}
      <div className="space-y-2">
        {tables?.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => setActive(t.name)}
            className="group flex w-full items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 text-left transition hover:bg-muted/60"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-foreground">
              <Table2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground">
                {t.rowEstimate > 0 ? `${t.rowEstimate.toLocaleString()} rows` : "—"}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        ))}
      </div>
      <MigrationHistory projectId={projectId} />
    </div>
  );
}

type HistoryEntry = {
  path: string;
  appliedAt: string;
  status: "success" | "failed";
  error: string | null;
};

function MigrationHistory({ projectId }: { projectId: string }) {
  const fnHistory = useServerFn(getMigrationHistory);
  const fnRun = useServerFn(runProjectMigrations);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fnHistory({ data: { projectId } });
      setEntries(res.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [fnHistory, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastFailed = entries?.find((e) => e.status === "failed") ?? null;

  async function retry() {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const res = await fnRun({ data: { projectId } });
      if (res.failed) {
        setRetryMsg(`Still failing: ${res.failed.error}`);
      } else if (res.applied.length > 0) {
        setRetryMsg(`Applied ${res.applied.length} migration${res.applied.length === 1 ? "" : "s"}.`);
      } else {
        setRetryMsg("Nothing to apply — already up to date.");
      }
      await load();
    } catch (e) {
      setRetryMsg(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  if (loading) return null;
  if (!entries || entries.length === 0) return null;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" />
          <span>Migration history</span>
        </div>
        {lastFailed && (
          <button
            type="button"
            disabled={retrying}
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background transition active:scale-95 disabled:opacity-60"
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
            Retry
          </button>
        )}
      </div>
      {retryMsg && (
        <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {retryMsg}
        </div>
      )}
      <ul className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
        {entries.map((e, i) => (
          <li
            key={`${e.path}-${e.appliedAt}-${i}`}
            className="flex items-start gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
          >
            <div className="mt-0.5 shrink-0">
              {e.status === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium" title={e.path}>
                {e.path.replace(/^supabase\/migrations\//, "")}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {new Date(e.appliedAt).toLocaleString()}
              </div>
              {e.error && (
                <div className="mt-1 line-clamp-3 break-words text-xs text-destructive/90">
                  {e.error}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CloudTableSample({
  projectId,
  table,
  onBack,
}: {
  projectId: string;
  table: string;
  onBack: () => void;
}) {
  const fn = useServerFn(sampleProjectTable);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn({ data: { projectId, table, limit: 20 } })
      .then((r) => {
        if (cancelled) return;
        setColumns(r.columns);
        setRows(r.rows as Record<string, unknown>[]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fn, projectId, table]);

  return (
    <div className="space-y-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to tables
      </button>
      <div className="text-base font-semibold">{table}</div>

      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <CloudEmptyState
          title="No rows"
          description={`The ${table} table is empty.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40">
                  {columns.map((c) => (
                    <td
                      key={c}
                      className="max-w-[180px] truncate px-3 py-2 align-top"
                      title={String(r[c] ?? "")}
                    >
                      {formatCell(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
