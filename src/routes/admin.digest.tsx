import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Mail, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/digest")({
  head: () => ({
    meta: [
      { title: "Admin · Self-learning digest" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminDigestPage,
});

type DigestSummary = {
  id: string;
  period_date: string;
  generated_at: string;
  total_turns: number;
  total_projects: number;
  total_users: number;
  verifier_pass_rate: number | null;
  build_success_rate: number | null;
  followup_was_fix_rate: number | null;
  timeout_rate: number | null;
  email_sent_at: string | null;
  email_recipients: string[] | null;
  email_error: string | null;
};

type DigestFull = DigestSummary & {
  avg_autofix_count: number | null;
  top_failure_signatures: Array<{
    signature: string;
    count: number;
    sampleMessage: string;
    surface: string | null;
    model: string | null;
  }>;
  top_reverted_prompts: Array<{
    sampleErrorPath: string;
    sampleErrorKind: string;
    count: number;
    model: string | null;
  }>;
  model_breakdown: Array<{
    model: string;
    turns: number;
    verifierPassRate: number;
    buildSuccessRate: number;
    avgAutofixCount: number;
  }>;
  recommendations: string[];
};

async function callDigestApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/admin/digests", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function AdminDigestPage() {
  const { ready } = useAdminGuard("/admin/digest");
  const [list, setList] = useState<DigestSummary[]>([]);
  const [selected, setSelected] = useState<DigestFull | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);

  async function loadList(autoSelectFirst = true) {
    setLoadingList(true);
    try {
      const { digests } = await callDigestApi<{ digests: DigestSummary[] }>({ action: "list" });
      setList(digests);
      if (autoSelectFirst && digests[0]) {
        await loadDetail(digests[0].id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(id: string) {
    setLoadingDetail(true);
    try {
      const { digest } = await callDigestApi<{ digest: DigestFull | null }>({ action: "get", id });
      setSelected(digest);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const { digest } = await callDigestApi<{ digest: DigestFull | null }>({ action: "run_now" });
      toast.success("Digest generated");
      setSelected(digest);
      await loadList(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (ready) void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Self-learning digest</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Generated daily at 00:00 UTC. Read it, fix the top thing, watch tomorrow improve.
            </p>
          </div>
          <Button onClick={runNow} disabled={running} variant="secondary" size="sm">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Generate now
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          {/* History list */}
          <Card className="border-border/60">
            <CardContent className="p-3">
              <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                History
              </div>
              {loadingList ? (
                <div className="px-2 py-6 text-xs text-muted-foreground">Loading…</div>
              ) : list.length === 0 ? (
                <div className="px-2 py-6 text-xs text-muted-foreground">
                  No digests yet. Hit "Generate now" to build today's.
                </div>
              ) : (
                <ul className="space-y-1">
                  {list.map((d) => {
                    const active = selected?.id === d.id;
                    return (
                      <li key={d.id}>
                        <button
                          onClick={() => loadDetail(d.id)}
                          className={`w-full rounded-md px-2 py-2 text-left text-sm transition ${
                            active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium tabular-nums">{d.period_date}</span>
                            {d.email_sent_at ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : d.email_error ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                            ) : (
                              <Mail className="h-3.5 w-3.5 text-muted-foreground/60" />
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {d.total_turns} turns · {pct(d.verifier_pass_rate)} verifier
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="space-y-4">
            {loadingDetail ? (
              <Card className="border-border/60">
                <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading digest…
                </CardContent>
              </Card>
            ) : !selected ? (
              <Card className="border-border/60">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Pick a digest from the list, or generate today's now.
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header + email status */}
                <Card className="border-border/60">
                  <CardContent className="p-5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Period
                        </div>
                        <div className="mt-1 font-display text-2xl tracking-tight">
                          {selected.period_date}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Generated {fmtRelative(selected.generated_at)}
                        </div>
                      </div>
                      <EmailStatus d={selected} />
                    </div>
                  </CardContent>
                </Card>

                {/* Totals */}
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Turns" value={String(selected.total_turns)} />
                  <Stat label="Projects" value={String(selected.total_projects)} />
                  <Stat label="Users" value={String(selected.total_users)} />
                  <Stat label="Verifier pass" value={pct(selected.verifier_pass_rate)} />
                  <Stat label="Build success" value={pct(selected.build_success_rate)} />
                  <Stat label="Follow-up was fix" value={pct(selected.followup_was_fix_rate)} />
                  <Stat label="Timeouts" value={pct(selected.timeout_rate)} />
                  <Stat
                    label="Avg autofixes / turn"
                    value={selected.avg_autofix_count != null ? Number(selected.avg_autofix_count).toFixed(2) : "—"}
                  />
                </section>

                {/* Recommendations */}
                {selected.recommendations.length > 0 && (
                  <Card className="border-border/60">
                    <CardContent className="p-5">
                      <h3 className="mb-2 text-sm font-medium tracking-tight">Recommendations</h3>
                      <ul className="space-y-2 text-sm">
                        {selected.recommendations.map((r, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Top failures */}
                <Card className="border-border/60">
                  <CardContent className="p-5">
                    <h3 className="mb-3 text-sm font-medium tracking-tight">Top failure signatures</h3>
                    {selected.top_failure_signatures.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No failures recorded in window.</p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {selected.top_failure_signatures.map((f, i) => (
                          <li key={i} className="py-3 text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate font-mono text-xs">{f.signature}</span>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums">
                                ×{f.count}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                              {f.sampleMessage}
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {f.surface ?? "—"} · {f.model ?? "—"}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Model breakdown */}
                <Card className="border-border/60">
                  <CardContent className="p-5">
                    <h3 className="mb-3 text-sm font-medium tracking-tight">By model</h3>
                    {selected.model_breakdown.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No model activity in window.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="pb-2">Model</th>
                            <th className="pb-2 text-right">Turns</th>
                            <th className="pb-2 text-right">Verifier</th>
                            <th className="pb-2 text-right">Build</th>
                            <th className="pb-2 text-right">Autofixes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.model_breakdown.map((m) => (
                            <tr key={m.model} className="border-t border-border/40">
                              <td className="py-2 font-mono text-xs">{m.model}</td>
                              <td className="py-2 text-right tabular-nums">{m.turns}</td>
                              <td className="py-2 text-right tabular-nums">{(m.verifierPassRate * 100).toFixed(1)}%</td>
                              <td className="py-2 text-right tabular-nums">{(m.buildSuccessRate * 100).toFixed(1)}%</td>
                              <td className="py-2 text-right tabular-nums">{m.avgAutofixCount.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>

                {/* Reverted prompts */}
                <Card className="border-border/60">
                  <CardContent className="p-5">
                    <h3 className="mb-3 text-sm font-medium tracking-tight">
                      Top patterns where users immediately asked for a fix
                    </h3>
                    {selected.top_reverted_prompts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No revert patterns recorded.</p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {selected.top_reverted_prompts.map((r, i) => (
                          <li key={i} className="py-2 text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate font-mono text-xs">
                                {r.sampleErrorKind} · {r.sampleErrorPath}
                              </span>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums">
                                ×{r.count}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{r.model ?? "—"}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

function EmailStatus({ d }: { d: DigestSummary }) {
  if (d.email_sent_at) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Emailed {d.email_recipients?.length ?? 0} admin{d.email_recipients?.length === 1 ? "" : "s"}
      </div>
    );
  }
  if (d.email_error) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Email failed: {d.email_error.slice(0, 60)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
      <Mail className="h-3.5 w-3.5" />
      No email sent (preview)
    </div>
  );
}
