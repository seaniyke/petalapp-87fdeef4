/**
 * W5 — nightly benchmark results.
 *
 * Read-only view of `benchmark_runs` / `benchmark_cases`. RLS restricts both
 * tables to admins, so the page queries them directly.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/benchmark")({
  head: () => ({
    meta: [
      { title: "Admin · Nightly benchmark" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminBenchmarkPage,
});

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  total_cases: number;
  completed_cases: number;
  build_completion: number | null;
  functional_correctness: number | null;
  spec_adherence: number | null;
  visual_quality: number | null;
  regression_safety: number | null;
  overall_score: number | null;
  regressions: Array<{ caseId: string; criterionId: string; text: string }> | null;
  error_message: string | null;
};

type CaseRow = {
  id: string;
  case_id: string;
  title: string;
  status: string;
  build_completed: boolean;
  functional_correctness: number | null;
  spec_adherence: number | null;
  visual_quality: number | null;
  regression_safety: number | null;
  criteria: Array<{ id: string; text: string; passed: boolean; note?: string }> | null;
  defects: string[] | null;
  duration_ms: number | null;
  error_message: string | null;
};

function pct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function scoreTone(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  if (value >= 0.9) return "text-emerald-500";
  if (value >= 0.7) return "text-amber-500";
  return "text-destructive";
}

function AdminBenchmarkPage() {
  const { ready, isAdmin } = useAdminGuard();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("benchmark_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as unknown as RunRow[];
    setRuns(rows);
    setSelected((prev) => prev ?? rows[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ready && isAdmin) void loadRuns();
  }, [ready, isAdmin, loadRuns]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("benchmark_cases")
        .select("*")
        .eq("run_id", selected)
        .order("created_at", { ascending: true });
      if (!cancelled) setCases((data ?? []) as unknown as CaseRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const run = runs.find((r) => r.id === selected) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Nightly benchmark</h1>
            <p className="text-sm text-muted-foreground">
              Fifteen frozen prompts, scored every night on build completion, functional
              correctness, spec adherence, visual quality and regression safety.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadRuns()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        {runs.length === 0 && !loading ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No benchmark runs yet. The suite runs nightly at 02:00 UTC.
            </CardContent>
          </Card>
        ) : null}

        {run ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Overall", value: run.overall_score },
                { label: "Build", value: run.build_completion },
                { label: "Functional", value: run.functional_correctness },
                { label: "Spec", value: run.spec_adherence },
                { label: "Visual", value: run.visual_quality },
                { label: "Regression", value: run.regression_safety },
              ].map((m) => (
                <Card key={m.label}>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className={`text-2xl font-bold ${scoreTone(m.value)}`}>{pct(m.value)}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <span className="font-medium capitalize">{run.status}</span>
                <span className="text-muted-foreground">
                  {run.completed_cases}/{run.total_cases} cases · {run.trigger} ·{" "}
                  {fmtRelative(run.started_at)}
                </span>
                {run.error_message ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-4 w-4" /> {run.error_message}
                  </span>
                ) : null}
              </CardContent>
            </Card>

            {run.regressions?.length ? (
              <Card className="border-destructive/40">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {run.regressions.length} regression
                    {run.regressions.length === 1 ? "" : "s"} since the previous run
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {run.regressions.map((r) => (
                      <li key={`${r.caseId}-${r.criterionId}`}>
                        <span className="font-mono text-xs">{r.caseId}</span> — {r.text}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            <div className="space-y-3">
              {cases.map((c) => (
                <Card key={c.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {c.status === "passed" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="font-medium">{c.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">{c.case_id}</span>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>build {c.build_completed ? "✓" : "✗"}</span>
                        <span>fn {pct(c.functional_correctness)}</span>
                        <span>spec {pct(c.spec_adherence)}</span>
                        <span>visual {pct(c.visual_quality)}</span>
                        {c.duration_ms ? <span>{Math.round(c.duration_ms / 1000)}s</span> : null}
                      </div>
                    </div>

                    {c.criteria?.length ? (
                      <ul className="grid gap-1 text-xs sm:grid-cols-2">
                        {c.criteria.map((cr) => (
                          <li key={cr.id} className="flex items-start gap-2">
                            {cr.passed ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            ) : (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                            )}
                            <span className={cr.passed ? "text-muted-foreground" : ""}>
                              {cr.text}
                              {cr.note ? (
                                <span className="text-muted-foreground"> — {cr.note}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {c.defects?.length ? (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">{c.defects.length} defect(s)</summary>
                        <ul className="mt-1 space-y-1">
                          {c.defects.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    {c.error_message ? (
                      <p className="text-xs text-destructive">{c.error_message}</p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>

            {runs.length > 1 ? (
              <Card>
                <CardContent className="space-y-1 p-4">
                  <div className="mb-2 text-sm font-semibold">History</div>
                  {runs.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                        r.id === selected ? "bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      <span>{new Date(r.started_at).toLocaleString()}</span>
                      <span className={scoreTone(r.overall_score)}>{pct(r.overall_score)}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
