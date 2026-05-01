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
} from "@/server/cloud-database.functions";
import {
  getMigrationHistory,
  runProjectMigrations,
} from "@/server/managed-migrations.functions";
import { CloudEmptyState } from "./CloudEmptyState";

type Props = { projectId: string };

export function CloudDatabaseView({ projectId }: Props) {
  const fnList = useServerFn(listProjectTables);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<CloudTableSummary[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fnList({ data: { projectId } })
      .then((res) => {
        if (cancelled) return;
        setAvailable(res.available);
        setTables(res.tables);
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

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Database className="h-4 w-4" />
        <span>{tables?.length ?? 0} tables</span>
      </div>
      {tables && tables.length === 0 && (
        <CloudEmptyState
          title="No tables yet"
          description="Petal hasn't created any database tables for this project yet. Ask Petal in chat — e.g. ‘add a recipes table with title and ingredients’."
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
