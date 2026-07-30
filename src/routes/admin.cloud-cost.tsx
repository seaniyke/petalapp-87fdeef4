import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  Cloud,
  Server,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/cloud-cost")({
  head: () => ({
    meta: [
      { title: "Admin · Cloud Cost" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminCloudCostPage,
});

type CloudCost = {
  total_backends: number;
  by_status: { ready?: number; provisioning?: number; paused?: number; failed?: number };
  by_type: { dedicated?: number; shared?: number };
  dedicated_ready: number;
  recently_paused: number;
  recently_hibernated: number;
  projects_with_backends: number;
  estimated_active_supabase_projects: number;
};

function AdminCloudCostPage() {
  const { ready } = useAdminGuard("/admin/cloud-cost");
  const [data, setData] = useState<CloudCost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    adminApi<CloudCost>({ action: "cloud_cost" })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ready]);

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
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Cloud cost</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Managed backend footprint and idle-activity signals.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigMetric
            label="Managed backends"
            value={data ? String(data.total_backends) : "—"}
            loading={loading}
            icon={<Cloud className="h-4 w-4" />}
          />
          <BigMetric
            label="Dedicated ready"
            value={data ? String(data.dedicated_ready) : "—"}
            sub={data ? `${data.by_type.dedicated ?? 0} dedicated total` : undefined}
            loading={loading}
            icon={<Server className="h-4 w-4" />}
          />
          <BigMetric
            label="Paused (30d)"
            value={data ? String(data.recently_paused) : "—"}
            sub={data ? `${data.by_status.paused ?? 0} total paused` : undefined}
            loading={loading}
            icon={<Clock className="h-4 w-4" />}
          />
          <BigMetric
            label="Active Supabase projects"
            value={data ? String(data.estimated_active_supabase_projects) : "—"}
            sub="Free plan, but count matters"
            loading={loading}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <h3 className="mb-3 text-sm font-medium tracking-tight">By status</h3>
              {loading || !data ? (
                <div className="h-24 animate-pulse rounded bg-muted/40" />
              ) : (
                <div className="space-y-2">
                  {Object.entries(data.by_status).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <span className="capitalize text-muted-foreground">{status}</span>
                      <span className="font-mono text-xs tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-5">
              <h3 className="mb-3 text-sm font-medium tracking-tight">By tier</h3>
              {loading || !data ? (
                <div className="h-24 animate-pulse rounded bg-muted/40" />
              ) : (
                <div className="space-y-2">
                  {Object.entries(data.by_type).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between text-sm">
                      <span className="capitalize text-muted-foreground">{type}</span>
                      <span className="font-mono text-xs tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="mt-6">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium tracking-tight">Cost optimization notes</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Dedicated managed backends are gated to paid users. Idle dedicated projects are
                    paused after 7 days of inactivity. Shared backends stay inside Petal Cloud and
                    do not spawn a new Supabase project.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SectionCard
            to="/admin/projects"
            title="Projects"
            description="Browse projects, inspect backend type and status per project."
            icon={<Server className="h-5 w-5" />}
          />
          <SectionCard
            to="/admin/billing"
            title="Billing settings"
            description="Adjust backend slot add-ons and pricing."
            icon={<Cloud className="h-5 w-5" />}
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
  loading,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
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
        <div className="mt-1">
          {loading ? (
            <span className="text-2xl font-semibold tracking-tight text-muted-foreground/60">—</span>
          ) : (
            <span className="text-2xl font-semibold tracking-tight">{value}</span>
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
  to: "/admin/projects" | "/admin/billing";
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
