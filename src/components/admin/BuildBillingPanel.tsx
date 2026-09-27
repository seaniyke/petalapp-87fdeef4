/**
 * Admin-only build billing summary: credits charged/refunded/reserved,
 * variable cost, represented revenue and contribution, with breakdowns.
 * Never rendered to customers.
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi } from "@/lib/admin-api";

type Row = Record<string, number | null>;
type Summary = Record<string, unknown> & {
  by_class?: Record<string, Row>;
  by_outcome?: Record<string, Row>;
  by_model?: Record<string, Row>;
  by_basis?: Record<string, Row>;
};

const n = (v: unknown, dp = 2) => (typeof v === "number" ? v.toFixed(dp) : v == null ? "—" : String(v));

function Table({ title, rows }: { title: string; rows?: Record<string, Row> }) {
  const entries = Object.entries(rows ?? {});
  if (!entries.length) return null;
  const cols = Object.keys(entries[0][1]);
  return (
    <div className="mt-4">
      <div className="text-sm font-medium mb-1">{title}</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr><th className="text-left">key</th>{cols.map((c) => <th key={c} className="text-right">{c}</th>)}</tr>
        </thead>
        <tbody>
          {entries.map(([k, r]) => (
            <tr key={k} className="border-t border-border">
              <td>{k}</td>
              {cols.map((c) => <td key={c} className="text-right tabular-nums">{n(r[c], c.includes("usd") ? 4 : 2)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BuildBillingPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [eff, setEff] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    adminApi<{ summary: Summary; effort?: Array<Record<string, unknown>> }>({ action: "build_billing", since_days: 30 })
      .then((r) => { setS(r.summary); setEff(r.effort ?? []); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  const k: Array<[string, string, number]> = [
    ["Builds", "builds", 0],
    ["Credits charged", "credits_charged", 2],
    ["Credits refunded", "credits_refunded", 2],
    ["Credits estimated", "credits_estimated", 2],
    ["Credits reserved", "credits_reserved", 2],
    ["Uncollected credits", "credits_uncollected", 2],
    ["Reservations refused", "reservations_refused", 0],
    ["Variable cost $", "variable_cost_usd", 4],
    ["Revenue represented $", "revenue_usd", 4],
    ["Contribution $", "contribution_usd", 4],
    ["Avg cost / build $", "avg_cost_per_build_usd", 4],
    ["Avg credits / build", "avg_credits_per_build", 3],
    ["Failed-build cost $", "failed_build_cost_usd", 4],
    ["Refunded-build cost $", "refunded_build_cost_usd", 4],
  ];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-medium">Build billing · last 30 days</div>
        {err && <div className="text-sm text-destructive mt-2">{err}</div>}
        {s && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              {k.map(([label, key, dp]) => (
                <div key={key}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="tabular-nums">{n(s[key], dp)}</div>
                </div>
              ))}
            </div>
            <Table title="Actual vs estimated cost" rows={s.by_basis} />
            <Table title="By class" rows={s.by_class} />
            <Table title="By outcome" rows={s.by_outcome} />
            <Table title="By model" rows={s.by_model} />
            {(["all", "class", "model"] as const).map((dim) => (
              <Table
                key={dim}
                title={`Effort pricing & profitability · ${dim === "all" ? "overall" : `by ${dim}`}`}
                rows={Object.fromEntries(eff.filter((r) => r.dim === dim).map((r) => {
                  const { dim: _d, key, ...rest } = r as Record<string, unknown>;
                  return [String(key), Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v == null ? null : Number(v)]))];
                })) as Record<string, Row>}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
