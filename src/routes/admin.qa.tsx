/**
 * Admin · Catalog QA
 *
 * Runs the static catalog validator (templates, packs, themes, snippets) and
 * lists findings grouped by severity. This is the safety net that lets us
 * answer "is the starter surface actually shippable?" without hand-auditing
 * 80+ entries every release.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, AlertOctagon, Info, CheckCircle2 } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runQAHarness, type Finding, type Severity } from "@/lib/qa-harness";

export const Route = createFileRoute("/admin/qa")({
  head: () => ({
    meta: [
      { title: "Admin · Catalog QA" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminQAPage,
});

const SEV_META: Record<Severity, { label: string; tone: string; Icon: typeof AlertTriangle }> = {
  error: { label: "Error", tone: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertOctagon },
  warn: { label: "Warning", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30", Icon: AlertTriangle },
  info: { label: "Info", tone: "bg-muted text-muted-foreground border-border", Icon: Info },
};

function AdminQAPage() {
  const { ready, isAdmin } = useAdminGuard("/admin/qa");
  const report = useMemo(() => runQAHarness(), []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-muted-foreground">
          {isAdmin ? "Loading…" : "Admin only."}
        </div>
      </div>
    );
  }

  const grouped: Record<Severity, Finding[]> = { error: [], warn: [], info: [] };
  for (const f of report.findings) grouped[f.severity].push(f);

  const allClear = report.counts.errors === 0 && report.counts.warnings === 0;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Catalog QA</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Static audit of templates, industry packs, themes, and snippets. Run before every release.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(report.ranAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Stat label="Templates" value={report.counts.templates} />
          <Stat label="Packs" value={report.counts.packs} />
          <Stat label="Themes" value={report.counts.themes} />
          <Stat label="Snippets" value={report.counts.snippets} />
          <Stat label="Errors" value={report.counts.errors} tone={report.counts.errors ? "text-destructive" : ""} />
          <Stat label="Warnings" value={report.counts.warnings} tone={report.counts.warnings ? "text-amber-600 dark:text-amber-400" : ""} />
        </div>

        {allClear && (
          <Card className="mt-6 border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="flex items-center gap-3 p-4 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <span>All catalog entries pass static checks.</span>
            </CardContent>
          </Card>
        )}

        {(["error", "warn", "info"] as Severity[]).map((sev) =>
          grouped[sev].length === 0 ? null : (
            <section key={sev} className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {SEV_META[sev].label} ({grouped[sev].length})
              </h2>
              <div className="space-y-2">
                {grouped[sev].map((f, i) => {
                  const meta = SEV_META[f.severity];
                  return (
                    <Card key={i} className={`border ${meta.tone}`}>
                      <CardContent className="flex items-start gap-3 p-3 text-sm">
                        <meta.Icon className="mt-0.5 h-4 w-4 flex-none" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {f.surface}
                            </Badge>
                            <code className="rounded bg-background/60 px-1.5 py-0.5 text-xs">{f.slug}</code>
                            <span className="text-xs text-muted-foreground">· {f.rule}</span>
                          </div>
                          <p className="mt-1 text-foreground/90">{f.message}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
