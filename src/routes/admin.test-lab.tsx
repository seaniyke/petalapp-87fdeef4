/**
 * Admin · Test Lab
 *
 * The internal view of what Kimble actually proved about the apps it shipped:
 * every recent test run across projects, with pass / fail / could-not-check
 * counts. Customers see the plain-language card on their build; this page is
 * where we watch whether the Test Lab itself is doing its job.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getAdminTestRuns, type AdminTestLabView } from "@/lib/test-lab.functions";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/test-lab")({
  head: () => ({
    meta: [
      { title: "Admin · Test Lab" },
      { name: "description", content: "Internal view of Kimble Test Lab runs across projects." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminTestLabPage,
});

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function AdminTestLabPage() {
  const { ready, isAdmin } = useAdminGuard("/admin/test-lab");
  const load = useServerFn(getAdminTestRuns);
  const [view, setView] = useState<AdminTestLabView | null>(null);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    let cancelled = false;
    void load({ data: {} })
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, isAdmin, load]);

  if (!ready) return null;
  if (!isAdmin) return null;

  const summary = view?.summary;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="font-display text-2xl tracking-[-0.02em]">Test Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What Kimble proved about shipped apps — runs, checks and gaps.
        </p>
        <AdminTabs />

        {summary && (
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Runs" value={summary.runs} />
            <Stat label="Passed" value={summary.passed} />
            <Stat label="Failed" value={summary.failed} />
            <Stat label="Could not check" value={summary.blocked} />
            <Stat label="Skipped" value={summary.skipped} />
            <Stat label="Runs with failures" value={summary.failingRuns} />
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Budget</th>
                <th className="px-3 py-2 text-right">Passed</th>
                <th className="px-3 py-2 text-right">Failed</th>
                <th className="px-3 py-2 text-right">Blocked</th>
                <th className="px-3 py-2 text-right">Skipped</th>
                <th className="px-3 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {(view?.runs ?? []).map((r) => (
                <tr key={r.runId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.projectName ?? r.projectId.slice(0, 8)}</span>
                    {r.blockedReason && (
                      <span className="block text-xs text-muted-foreground">{r.blockedReason}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={r.totals.failed > 0 ? "destructive" : "secondary"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.budget}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totals.passed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totals.failed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totals.blocked}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totals.skipped}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {view && view.runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No test runs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
