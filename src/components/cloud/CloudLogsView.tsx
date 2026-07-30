/**
 * CloudLogsView — real log streaming for a project's managed backend.
 *
 * Four sources (API, Postgres, Auth, Functions), a text filter, a time
 * window and optional live tail. Read-only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ScrollText, Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getProjectLogs,
  type CloudLogsResult,
  type LogSource,
} from "@/lib/cloud-logs.functions";
import { CloudEmptyState } from "@/components/cloud/CloudEmptyState";

const SOURCES: Array<{ id: LogSource; label: string }> = [
  { id: "api", label: "API" },
  { id: "postgres", label: "Database" },
  { id: "auth", label: "Auth" },
  { id: "functions", label: "Functions" },
];

const WINDOWS = [
  { minutes: 60, label: "1h" },
  { minutes: 60 * 6, label: "6h" },
  { minutes: 60 * 24, label: "24h" },
];

export function CloudLogsView({ projectId }: { projectId: string }) {
  const fetchLogs = useServerFn(getProjectLogs);
  const [source, setSource] = useState<LogSource>("api");
  const [minutes, setMinutes] = useState(60);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CloudLogsResult | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetchLogs({
          data: {
            projectId,
            source,
            minutes,
            search: searchRef.current.trim() || undefined,
          },
        });
        setResult(res);
      } catch (e) {
        setResult({
          available: true,
          reason: "ERROR",
          error: e instanceof Error ? e.message : "Could not load logs",
          entries: [],
        });
      } finally {
        setLoading(false);
      }
    },
    [fetchLogs, projectId, source, minutes],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced re-query when the filter changes.
  useEffect(() => {
    const t = setTimeout(() => void load(true), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(true), 10_000);
    return () => clearInterval(t);
  }, [live, load]);

  if (result && !result.available) {
    return (
      <div className="p-4">
        <CloudEmptyState
          title={result.reason === "NO_BACKEND" ? "No backend yet" : "Backend is starting"}
          description={
            result.reason === "NO_BACKEND"
              ? "Enable Petal Cloud for this project to see API, database and auth logs here."
              : "Your backend is still provisioning. Logs appear once it's ready."
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4" /> Logs
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                live
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {live ? "Live" : "Paused"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                source === s.id
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {WINDOWS.map((w) => (
            <button
              key={w.minutes}
              type="button"
              onClick={() => setMinutes(w.minutes)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                minutes === w.minutes
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !result ? (
          <div className="grid h-32 place-items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : result?.error ? (
          <div className="m-2 rounded-xl bg-destructive/10 p-4 text-sm font-medium text-destructive">
            {result.error}
          </div>
        ) : (result?.entries.length ?? 0) === 0 ? (
          <div className="m-2 rounded-xl bg-muted/40 p-6 text-sm font-medium text-muted-foreground">
            No log entries in this window. Use your app, then refresh.
          </div>
        ) : (
          <ul className="space-y-1">
            {result!.entries.map((e) => (
              <li
                key={e.id}
                className="rounded-lg px-2.5 py-2 font-mono text-xs leading-relaxed hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      e.level === "error"
                        ? "bg-destructive/15 text-destructive"
                        : e.level === "warn"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {e.level}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  {e.meta && <span className="truncate text-muted-foreground">{e.meta}</span>}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-foreground">
                  {e.message}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
