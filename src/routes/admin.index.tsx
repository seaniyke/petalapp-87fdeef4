import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  CreditCard,
  Users,
  FolderKanban,
  Receipt,
  Sparkles,
  Wallet,
  Globe,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin · Overview" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminIndexPage,
});

type Metrics = {
  totalProjects: number | null;
  publishedProjects: number | null;
  totalUsers: number | null;
  paidUsers: number | null;
  txCount30d: number | null;
  ledgerEntries30d: number | null;
};

const EMPTY: Metrics = {
  totalProjects: null,
  publishedProjects: null,
  totalUsers: null,
  paidUsers: null,
  txCount30d: null,
  ledgerEntries30d: null,
};

function AdminIndexPage() {
  const { ready } = useAdminGuard("/admin");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      setLoadingMetrics(true);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Run all metric queries in parallel. Each query independently survives
      // on its own — if one is blocked by RLS or fails, the others still show.
      const [projectsTotal, projectsPublished, walletsTotal, walletsPaid, tx30d, ledger30d] =
        await Promise.all([
          supabase.from("projects").select("id", { count: "exact", head: true }),
          supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("published_visibility", "public"),
          supabase.from("user_wallets").select("user_id", { count: "exact", head: true }),
          supabase
            .from("user_wallets")
            .select("user_id", { count: "exact", head: true })
            .neq("plan_code", "free"),
          supabase
            .from("paystack_transactions")
            .select("id", { count: "exact", head: true })
            .gte("created_at", since)
            .eq("status", "success"),
          supabase
            .from("credit_ledger")
            .select("id", { count: "exact", head: true })
            .gte("created_at", since),
        ]);

      if (cancelled) return;
      setMetrics({
        totalProjects: projectsTotal.count ?? null,
        publishedProjects: projectsPublished.count ?? null,
        totalUsers: walletsTotal.count ?? null,
        paidUsers: walletsPaid.count ?? null,
        txCount30d: tx30d.count ?? null,
        ledgerEntries30d: ledger30d.count ?? null,
      });
      setLoadingMetrics(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Overview of platform health and quick access to operational tools.
            </p>
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to app
          </Link>
        </div>

        {/* Metric tiles */}
        <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricTile
            label="Total projects"
            value={metrics.totalProjects}
            sub={
              metrics.publishedProjects != null
                ? `${metrics.publishedProjects} published`
                : undefined
            }
            icon={<FolderKanban className="h-4 w-4" />}
            loading={loadingMetrics}
          />
          <MetricTile
            label="Users (wallets)"
            value={metrics.totalUsers}
            sub={metrics.paidUsers != null ? `${metrics.paidUsers} on paid plan` : undefined}
            icon={<Users className="h-4 w-4" />}
            loading={loadingMetrics}
          />
          <MetricTile
            label="Successful payments · 30d"
            value={metrics.txCount30d}
            icon={<Wallet className="h-4 w-4" />}
            loading={loadingMetrics}
          />
          <MetricTile
            label="Ledger entries · 30d"
            value={metrics.ledgerEntries30d}
            icon={<Receipt className="h-4 w-4" />}
            loading={loadingMetrics}
          />
          <MetricTile
            label="Published share"
            value={
              metrics.totalProjects && metrics.publishedProjects != null
                ? `${Math.round((metrics.publishedProjects / Math.max(1, metrics.totalProjects)) * 100)}%`
                : null
            }
            icon={<Globe className="h-4 w-4" />}
            loading={loadingMetrics}
          />
          <MetricTile
            label="Paid conversion"
            value={
              metrics.totalUsers && metrics.paidUsers != null
                ? `${Math.round((metrics.paidUsers / Math.max(1, metrics.totalUsers)) * 100)}%`
                : null
            }
            icon={<Sparkles className="h-4 w-4" />}
            loading={loadingMetrics}
          />
        </section>

        {/* Section links */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SectionCard
            to="/admin/billing"
            title="Billing settings"
            description="Plans, credit packs, currencies and per-currency price overrides."
            icon={<CreditCard className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/users"
            title="Users & roles"
            description="Search users, inspect wallets and grant or revoke admin access."
            icon={<Users className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/projects"
            title="Projects"
            description="Browse all projects, feature picks and moderate published apps."
            icon={<FolderKanban className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/ledgers"
            title="Ledgers & transactions"
            description="Recent credit ledger entries and Paystack transactions."
            icon={<Receipt className="h-5 w-5" />}
          />
        </section>
      </main>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  icon,
  loading,
}: {
  label: string;
  value: number | string | null;
  sub?: string;
  icon: React.ReactNode;
  loading: boolean;
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
            <span className="text-2xl font-semibold tracking-tight text-muted-foreground/60">
              —
            </span>
          ) : (
            <span className="text-2xl font-semibold tracking-tight">
              {value == null ? "—" : value}
            </span>
          )}
          {sub && !loading && (
            <span className="text-xs text-muted-foreground">{sub}</span>
          )}
        </div>
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
  to: "/admin/billing" | "/admin/users" | "/admin/projects" | "/admin/ledgers";
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

