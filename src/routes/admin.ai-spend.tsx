/**
 * Admin → AI Spend by Project.
 *
 * Surfaces per-project AI cost attribution (P1-5). Data comes from the
 * `project_id` column on `ai_call_log` that we backfilled through every
 * `aiChatCompletions` call site. Useful for spotting runaway projects
 * before they trigger user-facing rate limits or wallet drain.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Download, ExternalLink } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi, fmtUsd, fmtRelative, downloadCsv } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/ai-spend")({
  head: () => ({
    meta: [
      { title: "Admin · AI Spend" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminAiSpendPage,
});

type ProjectSpend = {
  project_id: string;
  title: string;
  slug: string | null;
  owner_id: string | null;
  owner_email: string | null;
  published: boolean;
  calls: number;
  errors: number;
  tokens: number;
  cost_usd_cents: number;
  last_call_at: string;
};

type Response = {
  since_days: number;
  total_projects: number;
  total_cost_cents: number;
  total_calls: number;
  projects: ProjectSpend[];
};

function AdminAiSpendPage() {
  const { ready } = useAdminGuard("/admin/ai-spend");
  const [sinceDays, setSinceDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Response | null>(null);

  async function load(days = sinceDays) {
    setLoading(true);
    try {
      const res = await adminApi<Response>({
        action: "project_ai_spend",
        since_days: Number(days),
        limit: 200,
      });
      setData(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    void load(sinceDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Spend by Project</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Petal AI Gateway cost attributed per project. Use this to find
              runaway agents before they drain a user's wallet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={sinceDays}
              onValueChange={(v) => {
                setSinceDays(v);
                void load(v);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!data?.projects.length}
              onClick={() => {
                if (!data) return;
                downloadCsv(
                  `ai-spend-${sinceDays}d.csv`,
                  data.projects.map((p) => ({
                    project_id: p.project_id,
                    title: p.title,
                    owner_email: p.owner_email,
                    published: p.published,
                    calls: p.calls,
                    errors: p.errors,
                    tokens: p.tokens,
                    cost_usd: (p.cost_usd_cents / 100).toFixed(4),
                    last_call_at: p.last_call_at,
                  })),
                );
              }}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label="Total AI cost" value={fmtUsd(data?.total_cost_cents ?? 0)} />
          <SummaryCard
            label="Projects with AI calls"
            value={(data?.total_projects ?? 0).toLocaleString()}
          />
          <SummaryCard label="Total calls" value={(data?.total_calls ?? 0).toLocaleString()} />
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Project</th>
                    <th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                    <th className="px-4 py-2 text-right">Calls</th>
                    <th className="px-4 py-2 text-right">Errors</th>
                    <th className="px-4 py-2 text-right">Tokens</th>
                    <th className="px-4 py-2">Last call</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </td>
                    </tr>
                  ) : !data?.projects.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No AI calls in this window.
                      </td>
                    </tr>
                  ) : (
                    data.projects.map((p) => (
                      <tr key={p.project_id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Link
                              to="/admin/projects"
                              search={{ q: p.title }}
                              className="font-medium hover:underline"
                            >
                              {p.title}
                            </Link>
                            {p.published && p.slug ? (
                              <a
                                href={`/p/${p.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                                title="Open published"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{p.project_id}</div>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {p.owner_email ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{fmtUsd(p.cost_usd_cents)}</td>
                        <td className="px-4 py-2 text-right">{p.calls.toLocaleString()}</td>
                        <td className={`px-4 py-2 text-right ${p.errors > 0 ? "text-destructive" : ""}`}>
                          {p.errors.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                          {p.tokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {fmtRelative(p.last_call_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
