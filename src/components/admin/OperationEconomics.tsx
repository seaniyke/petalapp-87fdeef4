import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

type Json = Record<string, unknown>;
const rpc = supabase.rpc as unknown as (fn: string, args?: Json) => Promise<{ data: unknown; error: { message: string } | null }>;

function money(v: unknown, dp = 4): string {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(dp)}` : "—";
}
function pct(v: unknown): string {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;
}
function quartiles(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => money(x)).join(" / ") : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

/** Outcome and project-lifetime economics, keyed by exact economic operation. */
export function OperationEconomicsPanel() {
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void rpc("operation_economics_report").then(({ data, error }) => {
      if (error) setError(error.message);
      else setData((data ?? {}) as Json);
    });
  }, []);
  if (error) return <p className="text-sm text-destructive">Outcome economics unavailable: {error}</p>;
  if (!data) return null;
  const basis = (data.cost_basis_totals ?? {}) as Json;
  const rates = (data.failure_rates ?? {}) as Json;
  const byType = (data.by_type ?? []) as Json[];
  const projects = (data.projects ?? []) as Json[];
  const pAll = ((data.percentiles ?? {}) as Json).all;
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold">Outcome economics (last 30 days)</h2>
          <p className="text-xs text-muted-foreground">
            Per exact operation. Direct cost = ACTUAL + ESTIMATED; allocated and unknown shown separately. Credit = {money(data.credit_usd, 2)}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Operations" value={String(data.operations ?? 0)} />
          <Stat label="Successful outcomes" value={String(data.successful_outcomes ?? 0)} />
          <Stat label="Cost / successful outcome" value={money(data.cost_per_successful_outcome)} />
          <Stat label="Retained revenue / success" value={money(data.retained_revenue_per_successful_outcome)} />
          <Stat label="Gross profit / success" value={money(data.gross_profit_per_successful_outcome)} />
          <Stat label="Failed-work cost" value={money(data.failed_work_cost)} />
          <Stat label="Refunded cost" value={money(data.refunded_cost)} />
          <Stat label="Success rate" value={pct(data.success_rate)} />
          <Stat label="Customer-outcome failures" value={pct(rates.customer_outcome)} />
          <Stat label="Verification-only failures" value={pct(rates.verification_only)} />
          <Stat label="Infrastructure failures" value={pct(rates.infrastructure)} />
          <Stat label="Stale/late callbacks" value={pct(rates.stale_callback)} />
          <Stat label="ACTUAL" value={money(basis.actual)} />
          <Stat label="ESTIMATED" value={money(basis.estimated)} />
          <Stat label="ALLOCATED (not in direct)" value={money(basis.allocated)} />
          <Stat label="UNKNOWN items" value={String(basis.unknown_items ?? 0)} />
        </div>
        <div className="text-xs">
          <div>Operation cost P50/P75/P90/P95: <span className="font-mono">{quartiles(pAll)}</span></div>
          <div>Successful operation cost P50/P75/P90/P95: <span className="font-mono">{quartiles(data.percentiles_successful)}</span></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr>
              <th className="text-left">Type</th><th>Ops</th><th>Successes</th><th>Avg cost</th><th>Cost / success</th><th>P50</th><th>P75</th><th>P90</th><th>P95</th>
            </tr></thead>
            <tbody>{byType.map((r) => (
              <tr key={String(r.operation_type)} className="border-t border-border">
                <td>{String(r.operation_type)}</td><td className="text-center">{String(r.n)}</td><td className="text-center">{String(r.successes)}</td>
                <td className="text-center font-mono">{money(r.avg_cost)}</td><td className="text-center font-mono">{money(r.cost_per_success)}</td>
                <td className="text-center font-mono">{money(r.p50)}</td><td className="text-center font-mono">{money(r.p75)}</td>
                <td className="text-center font-mono">{money(r.p90)}</td><td className="text-center font-mono">{money(r.p95)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <h3 className="mb-1 text-sm font-medium">Project lifetime</h3>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr>
              <th className="text-left">Project</th><th>Ops</th><th>OK</th><th>Failed</th><th>Credits</th><th>Revenue</th><th>Direct cost</th><th>Failed work</th><th>Refunds</th><th>Profit</th><th>Margin</th><th>Cost / success</th>
            </tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={String(p.project_id)} className="border-t border-border">
                <td className="font-mono">{String(p.project_id).slice(0, 8)}</td>
                <td className="text-center">{String(p.operations)}</td><td className="text-center">{String(p.successful)}</td><td className="text-center">{String(p.failed)}</td>
                <td className="text-center">{String(p.credits_consumed ?? 0)}</td><td className="text-center font-mono">{money(p.retained_revenue)}</td>
                <td className="text-center font-mono">{money(p.direct_cost)}</td><td className="text-center font-mono">{money(p.failed_work_cost)}</td>
                <td className="text-center">{String(p.refunds ?? 0)}</td><td className="text-center font-mono">{money(p.gross_profit)}</td>
                <td className="text-center">{pct(p.gross_margin)}</td><td className="text-center font-mono">{money(p.cost_per_successful_operation)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** 10-build measurement cohort. Labelling is OFF until the lifecycle is verified. */
export function CohortPanel() {
  const [data, setData] = useState<Json | null>(null);
  useEffect(() => {
    void rpc("economics_cohort_report").then(({ data }) => setData((data ?? {}) as Json));
  }, []);
  return (
    <Card>
      <CardContent className="space-y-1 p-4 text-sm">
        <h2 className="text-base font-semibold">10-build cohort</h2>
        <p className="text-xs text-muted-foreground">
          Paused: cohort labelling stays off until the lifecycle architecture passes verification.
        </p>
        {data && Number(data.builds ?? 0) > 0 ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Builds" value={String(data.builds)} />
            <Stat label="Cost / retained credit" value={money(data.cost_per_retained_credit, 5)} />
            <Stat label="Cache hit rate" value={pct(data.cache_hit_rate)} />
            <Stat label="Failed-work cost" value={money(data.failed_work_cost_usd)} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
