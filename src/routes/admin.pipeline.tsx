import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Activity, AlertTriangle, Package, Clock } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi, fmtRelative } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pipeline")({
  head: () => ({
    meta: [
      { title: "Admin · Pipeline telemetry" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPipelinePage,
});

type TierStat = {
  tier: string;
  total: number;
  ok: number;
  failed: number;
  fixed: number;
  warned: number;
  skipped: number;
  ok_pct: number;
  failed_pct: number;
  p50_ms: number;
  p95_ms: number;
  avg_issues: number;
};

type RecentEvent = {
  turn_id: string;
  tier: string;
  outcome: string;
  duration_ms: number;
  issue_count: number;
  model: string | null;
  project_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
};

type Stats = {
  since_hours: number;
  total_events: number;
  total_turns: number;
  tier_stats: TierStat[];
  top_hallucinated: Array<{ package: string; count: number }>;
  handoff_reasons: Array<{ reason: string; count: number }>;
  recent_events: RecentEvent[];
};

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
];

function AdminPipelinePage() {
  const { ready } = useAdminGuard("/admin/pipeline");
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    adminApi<Stats>({ action: "pipeline_stats", since_hours: hours })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ready, hours]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <AdminTabs />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Pipeline telemetry</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-tier outcomes for every build turn · last {labelFor(hours)}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border/60 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                onClick={() => setHours(w.hours)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  hours === w.hours
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SmallMetric label="Turns" value={data ? String(data.total_turns) : "—"} loading={loading} icon={<Activity className="h-4 w-4" />} />
          <SmallMetric label="Tier events" value={data ? String(data.total_events) : "—"} loading={loading} icon={<Clock className="h-4 w-4" />} />
          <SmallMetric
            label="Failed events"
            value={data ? String(data.tier_stats.reduce((s, t) => s + t.failed, 0)) : "—"}
            loading={loading}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <SmallMetric
            label="Hallu pkg hits"
            value={data ? String(data.top_hallucinated.reduce((s, h) => s + h.count, 0)) : "—"}
            loading={loading}
            icon={<Package className="h-4 w-4" />}
          />
        </section>

        <Card className="mb-6 border-border/60">
          <CardContent className="p-5">
            <h3 className="mb-3 text-sm font-medium tracking-tight">Per-tier breakdown</h3>
            {loading || !data ? (
              <div className="h-32 animate-pulse rounded bg-muted/40" />
            ) : data.tier_stats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No telemetry recorded in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="py-2 pr-3 font-medium">Tier</th>
                      <th className="py-2 pr-3 font-medium">Total</th>
                      <th className="py-2 pr-3 font-medium">OK%</th>
                      <th className="py-2 pr-3 font-medium">Failed%</th>
                      <th className="py-2 pr-3 font-medium">Fixed</th>
                      <th className="py-2 pr-3 font-medium">Warned</th>
                      <th className="py-2 pr-3 font-medium">Skipped</th>
                      <th className="py-2 pr-3 font-medium">p50 ms</th>
                      <th className="py-2 pr-3 font-medium">p95 ms</th>
                      <th className="py-2 font-medium">avg issues</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {data.tier_stats.map((t) => (
                      <tr key={t.tier} className="border-b border-border/40">
                        <td className="py-2 pr-3 font-sans font-medium">{t.tier}</td>
                        <td className="py-2 pr-3">{t.total}</td>
                        <td className={`py-2 pr-3 ${t.ok_pct >= 90 ? "text-emerald-600" : t.ok_pct >= 60 ? "text-amber-600" : "text-red-600"}`}>
                          {t.ok_pct}%
                        </td>
                        <td className={`py-2 pr-3 ${t.failed_pct === 0 ? "text-muted-foreground" : t.failed_pct < 10 ? "text-amber-600" : "text-red-600"}`}>
                          {t.failed_pct}%
                        </td>
                        <td className="py-2 pr-3 text-blue-600">{t.fixed}</td>
                        <td className="py-2 pr-3 text-amber-600">{t.warned}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{t.skipped}</td>
                        <td className="py-2 pr-3">{t.p50_ms}</td>
                        <td className="py-2 pr-3">{t.p95_ms}</td>
                        <td className="py-2">{t.avg_issues}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <h3 className="mb-3 text-sm font-medium tracking-tight">Top hallucinated packages</h3>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : data.top_hallucinated.length === 0 ? (
                <p className="text-xs text-muted-foreground">None detected. 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {data.top_hallucinated.map((h) => (
                    <li key={h.package} className="flex items-center justify-between text-sm">
                      <code className="truncate font-mono text-xs">{h.package}</code>
                      <span className="font-mono text-xs tabular-nums text-red-600">×{h.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-5">
              <h3 className="mb-3 text-sm font-medium tracking-tight">Handoff reasons</h3>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : data.handoff_reasons.length === 0 ? (
                <p className="text-xs text-muted-foreground">No early handoffs in window.</p>
              ) : (
                <ul className="space-y-2">
                  {data.handoff_reasons.map((h) => (
                    <li key={h.reason} className="flex items-center justify-between text-sm">
                      <span className="truncate">{h.reason}</span>
                      <span className="font-mono text-xs tabular-nums text-amber-600">×{h.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="border-border/60">
          <CardContent className="p-5">
            <h3 className="mb-3 text-sm font-medium tracking-tight">Recent events</h3>
            {loading || !data ? (
              <div className="h-32 animate-pulse rounded bg-muted/40" />
            ) : data.recent_events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.recent_events.map((e, i) => (
                  <li key={`${e.turn_id}-${e.tier}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{e.tier}</span>
                        <OutcomeBadge outcome={e.outcome} />
                        {e.issue_count > 0 && (
                          <span className="text-[10px] text-muted-foreground">{e.issue_count} issues</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        turn {e.turn_id.slice(0, 8)} · {e.model ?? "—"} · {fmtRelative(e.created_at)}
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {e.duration_ms}ms
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function labelFor(hours: number): string {
  return WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}h`;
}

function SmallMetric({
  label,
  value,
  loading,
  icon,
}: {
  label: string;
  value: string;
  loading: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        {loading ? (
          <span className="text-2xl font-semibold tracking-tight text-muted-foreground/60">—</span>
        ) : (
          <span className="text-2xl font-semibold tracking-tight">{value}</span>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cls =
    outcome === "ok"
      ? "bg-emerald-500/15 text-emerald-600"
      : outcome === "failed"
        ? "bg-red-500/15 text-red-600"
        : outcome === "fixed"
          ? "bg-blue-500/15 text-blue-600"
          : outcome === "warned"
            ? "bg-amber-500/15 text-amber-600"
            : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{outcome}</span>;
}
