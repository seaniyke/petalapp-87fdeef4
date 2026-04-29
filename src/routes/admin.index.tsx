import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  CreditCard,
  Users,
  FolderKanban,
  Receipt,
  Wallet,
  Cpu,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Activity,
  Gauge,
} from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi, fmtUsd, fmtRelative } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin · Overview" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminIndexPage,
});

type Dashboard = {
  since_days: number;
  revenue_usd_cents: number;
  prev_revenue_usd_cents: number;
  ledger_entries: number;
  wallets_total: number;
  wallets_paid: number;
  projects_total: number;
  projects_published: number;
  signups_in_window: number;
  signups_prev: number;
  users_total: number;
  revenue_series: Array<{ date: string; cents: number }>;
  top_spenders: Array<{ user_id: string; email: string | null; lifetime_window_cents: number }>;
  recent_transactions: Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    status: string;
    usd_amount_cents: number;
    purpose: string;
    created_at: string;
  }>;
  recent_ledger: Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    delta: number;
    reason: string;
    created_at: string;
  }>;
};

function AdminIndexPage() {
  const { ready } = useAdminGuard("/admin");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(30);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    adminApi<Dashboard>({ action: "dashboard", since_days: windowDays })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ready, windowDays]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  const revDelta = data
    ? data.prev_revenue_usd_cents > 0
      ? Math.round(((data.revenue_usd_cents - data.prev_revenue_usd_cents) / data.prev_revenue_usd_cents) * 100)
      : data.revenue_usd_cents > 0
        ? 100
        : 0
    : 0;
  const signupDelta = data
    ? data.signups_prev > 0
      ? Math.round(((data.signups_in_window - data.signups_prev) / data.signups_prev) * 100)
      : data.signups_in_window > 0
        ? 100
        : 0
    : 0;

  const maxRev = data ? Math.max(1, ...data.revenue_series.map((p) => p.cents)) : 1;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live business overview · last {windowDays} days
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border/60 p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  windowDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Top metrics */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigMetric
            label={`Revenue · ${windowDays}d`}
            value={data ? fmtUsd(data.revenue_usd_cents) : "—"}
            delta={revDelta}
            loading={loading}
            icon={<Wallet className="h-4 w-4" />}
          />
          <BigMetric
            label={`Signups · ${windowDays}d`}
            value={data ? String(data.signups_in_window) : "—"}
            delta={signupDelta}
            loading={loading}
            icon={<Users className="h-4 w-4" />}
          />
          <BigMetric
            label="Total users"
            value={data ? String(data.users_total) : "—"}
            sub={data ? `${data.wallets_paid} on paid plan` : undefined}
            loading={loading}
            icon={<Users className="h-4 w-4" />}
          />
          <BigMetric
            label="Total projects"
            value={data ? String(data.projects_total) : "—"}
            sub={data ? `${data.projects_published} published` : undefined}
            loading={loading}
            icon={<FolderKanban className="h-4 w-4" />}
          />
        </section>

        {/* Revenue chart + top spenders */}
        <section className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="border-border/60 lg:col-span-2">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium tracking-tight">Revenue (USD)</h3>
                <span className="text-xs text-muted-foreground">
                  {data ? fmtUsd(data.revenue_usd_cents) : "—"}
                </span>
              </div>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : (
                <div className="flex h-32 items-end gap-[2px]">
                  {data.revenue_series.map((p) => (
                    <div
                      key={p.date}
                      title={`${p.date}: ${fmtUsd(p.cents)}`}
                      className="flex-1 rounded-t bg-primary/70 transition hover:bg-primary"
                      style={{
                        height: `${Math.max(2, Math.round((p.cents / maxRev) * 100))}%`,
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{data?.revenue_series[0]?.date}</span>
                <span>{data?.revenue_series.at(-1)?.date}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-5">
              <h3 className="mb-3 text-sm font-medium tracking-tight">Top spenders</h3>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : data.top_spenders.length === 0 ? (
                <p className="text-xs text-muted-foreground">No revenue in window.</p>
              ) : (
                <ul className="space-y-2">
                  {data.top_spenders.map((s) => (
                    <li key={s.user_id} className="flex items-center justify-between text-sm">
                      <Link
                        to="/admin/users"
                        className="truncate text-foreground hover:underline"
                      >
                        {s.email ?? s.user_id.slice(0, 8)}
                      </Link>
                      <span className="font-mono text-xs tabular-nums">
                        {fmtUsd(s.lifetime_window_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Recent activity */}
        <section className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium tracking-tight">Latest payments</h3>
              </div>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : data.recent_transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transactions yet.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {data.recent_transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{t.user_email ?? t.user_id.slice(0, 8)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.purpose} · {fmtRelative(t.created_at)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs tabular-nums">{fmtUsd(t.usd_amount_cents)}</div>
                        <div
                          className={`text-[10px] ${
                            t.status === "success"
                              ? "text-emerald-600"
                              : t.status === "failed"
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {t.status}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium tracking-tight">Latest credit activity</h3>
              </div>
              {loading || !data ? (
                <div className="h-32 animate-pulse rounded bg-muted/40" />
              ) : data.recent_ledger.length === 0 ? (
                <p className="text-xs text-muted-foreground">No ledger entries yet.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {data.recent_ledger.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{l.user_email ?? l.user_id.slice(0, 8)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.reason} · {fmtRelative(l.created_at)}
                        </div>
                      </div>
                      <div
                        className={`font-mono text-xs tabular-nums ${
                          Number(l.delta) >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {Number(l.delta) >= 0 ? "+" : ""}
                        {Number(l.delta).toFixed(2)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Section nav */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SectionCard
            to="/admin/users"
            title="Users"
            description="Browse all users, inspect projects & payments, suspend or delete accounts."
            icon={<Users className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/projects"
            title="Projects"
            description="Browse every project, feature picks, moderate published apps."
            icon={<FolderKanban className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/ledgers"
            title="Ledgers & transactions"
            description="Filterable Paystack transactions and credit ledger with CSV export."
            icon={<Receipt className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/billing"
            title="Billing settings"
            description="Plans, credit packs, currencies and per-currency price overrides."
            icon={<CreditCard className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/ai-providers"
            title="AI Providers"
            description="Route each AI feature to Lovable AI or OpenRouter to control cost."
            icon={<Cpu className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/pipeline"
            title="Pipeline telemetry"
            description="Per-tier outcomes, latency p50/p95, top hallucinated packages and handoff reasons."
            icon={<Gauge className="h-5 w-5" />}
          />
        </section>
      </main>
    </div>
  );
}

function BigMetric({
  label,
  value,
  sub,
  delta,
  loading,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
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
        <div className="mt-1 flex items-baseline gap-2">
          {loading ? (
            <span className="text-2xl font-semibold tracking-tight text-muted-foreground/60">—</span>
          ) : (
            <span className="text-2xl font-semibold tracking-tight">{value}</span>
          )}
          {!loading && delta != null && delta !== 0 && (
            <span
              className={`flex items-center gap-0.5 text-[11px] font-medium ${
                delta >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>
        {sub && !loading && <span className="text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  to,
  title,
  description,
  icon,
}: {
  to: "/admin/billing" | "/admin/users" | "/admin/projects" | "/admin/ledgers" | "/admin/ai-providers" | "/admin/pipeline";
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border/60 bg-card/40 p-5 transition hover:border-primary/40 hover:bg-card"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="font-medium tracking-tight">{title}</h3>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
  );
}
