/**
 * Admin · Pipeline failures
 *
 * Surfaces the raw error strings that hit the "Petal got a bit confused"
 * branch in `friendly-errors.ts`. These are failures that today bypass our
 * `ai_call_log` and `ai_call_outcomes` telemetry entirely — i.e. silent
 * client-side / stream-parser / tool-arg failures.
 *
 * Use this view to rank what's actually breaking, then pattern-match the
 * top signatures back into `friendly-errors.ts`.
 */
import { useEffect, useState, Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, AlertTriangle } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi, fmtRelative } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/failures")({
  head: () => ({
    meta: [
      { title: "Admin · Failures" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminFailuresPage,
});

type Sample = {
  id: string;
  project_id: string | null;
  surface: string;
  raw_message: string;
  signature: string;
  tool_name: string | null;
  model: string | null;
  stream_tail: string | null;
  url: string | null;
  created_at: string;
};

type Group = {
  signature: string;
  count: number;
  surfaces: string[];
  models: string[];
  sample: Sample;
};

type Stats = {
  since_hours: number;
  total: number;
  groups: Group[];
  recent: Sample[];
};

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
];

function AdminFailuresPage() {
  const { ready } = useAdminGuard("/admin/failures");
  const [stats, setStats] = useState<Stats | null>(null);
  const [windowH, setWindowH] = useState(24);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await adminApi<Stats>({
          action: "pipeline_failures",
          since_hours: windowH,
        });
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, windowH]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Pipeline failures</h1>
            <p className="text-xs text-muted-foreground">
              Errors that fell through to the generic "Petal got a bit confused" card.
              Grouped by signature so the top rows are the highest-impact bugs to pattern-match next.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                onClick={() => setWindowH(w.hours)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  windowH === w.hours
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {loading && !stats ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !stats || stats.total === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertTriangle className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No unmatched failures in this window. Nice.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="px-4 py-3 text-sm">
                <span className="font-medium">{stats.total}</span>{" "}
                <span className="text-muted-foreground">
                  unmatched failures in the last {windowH}h, grouped into{" "}
                  {stats.groups.length} signature{stats.groups.length === 1 ? "" : "s"}.
                </span>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Count</th>
                      <th className="px-4 py-2 text-left">Signature</th>
                      <th className="px-4 py-2 text-left">Surface</th>
                      <th className="px-4 py-2 text-left">Models</th>
                      <th className="px-4 py-2 text-left">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.groups.map((g) => {
                      const open = expanded === g.signature;
                      return (
                        <Fragment key={g.signature}>
                          <tr
                            onClick={() => setExpanded(open ? null : g.signature)}
                            className="cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/30"
                          >
                            <td className="px-4 py-2 font-mono text-xs">{g.count}</td>
                            <td className="px-4 py-2 font-mono text-xs">
                              {g.signature || "(empty)"}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {g.surfaces.join(", ")}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {g.models.length ? g.models.join(", ") : "—"}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {fmtRelative(g.sample.created_at)}
                            </td>
                          </tr>
                          {open ? (
                            <tr key={g.signature + "-detail"} className="bg-muted/20">
                              <td colSpan={5} className="px-4 py-3">
                                <div className="space-y-2 text-xs">
                                  <div>
                                    <div className="font-medium text-foreground">Raw message</div>
                                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono">
                                      {g.sample.raw_message}
                                    </pre>
                                  </div>
                                  {g.sample.tool_name ? (
                                    <div className="text-muted-foreground">
                                      tool: <span className="font-mono">{g.sample.tool_name}</span>
                                    </div>
                                  ) : null}
                                  {g.sample.url ? (
                                    <div className="text-muted-foreground">
                                      url: <span className="font-mono">{g.sample.url}</span>
                                    </div>
                                  ) : null}
                                  {g.sample.project_id ? (
                                    <div className="text-muted-foreground">
                                      project: <span className="font-mono">{g.sample.project_id}</span>
                                    </div>
                                  ) : null}
                                  {g.sample.stream_tail ? (
                                    <div>
                                      <div className="font-medium text-foreground">Stream tail</div>
                                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono">
                                        {g.sample.stream_tail}
                                      </pre>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
