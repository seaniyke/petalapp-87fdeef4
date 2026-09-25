/**
 * Admin → Economics.
 *
 * Internal only. Shows what a turn actually costs Kimble against what it
 * charged, and is honest about how much of that is measured versus inferred.
 * Nothing on this page is ever surfaced to a customer.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, AlertTriangle } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi } from "@/lib/admin-api";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/economics")({
  head: () => ({
    meta: [
      { title: "Admin · Economics" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminEconomicsPage,
});

type Bucket = { turns: number; credits: number; cost: number };

type EconomicsResponse = {
  since_days: number;
  coverage: {
    turns: number;
    by_basis: Record<string, number>;
    known_pct: number;
    ai_calls: number;
    ai_calls_by_basis: Record<string, number>;
  };
  totals: {
    credits_charged: number;
    variable_cost_usd: number;
    cost_per_credit_usd: number | null;
    target_cost_per_credit_usd: number;
  };
  by_feature: Record<string, Bucket>;
  by_model: Record<string, { calls: number; cost: number }>;
  builds: {
    total: number;
    ready: number;
    failed: number;
    p50_ms: number | null;
    p90_ms: number | null;
    p95_ms: number | null;
  };
  top_projects: Array<{ project_id: string; turns: number; credits: number; cost: number }>;
  ai_rollup?: {
    turns: number;
    avg_calls_per_turn: number;
    avg_input_tokens: number;
    avg_output_tokens: number;
    cache_hit_pct: number | null;
    retries_per_turn: number;
    error_rate_pct: number;
    calls_without_usage_pct: number;
    avg_cost_per_turn_usd: number;
  } | null;
  config: Record<string, number>;
  alerts: string[];
};

function usd(n: number | null | undefined, dp = 4) {
  if (n === null || n === undefined) return "unknown";
  return `$${n.toFixed(dp)}`;
}

function secs(ms: number | null) {
  return ms === null ? "—" : `${Math.round(ms / 100) / 10}s`;
}

function AdminEconomicsPage() {
  const { ready } = useAdminGuard("/admin/economics");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EconomicsResponse | null>(null);

  async function load(d = days) {
    setLoading(true);
    try {
      setData(await adminApi<EconomicsResponse>({ action: "economics", since_days: Number(d) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ready) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <CohortPanel />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Economics</h1>
            <p className="text-sm text-muted-foreground">
              What turns cost us against what they charged. Internal only.
            </p>
          </div>
          <Select
            value={days}
            onValueChange={(v) => {
              setDays(v);
              void load(v);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {data && (
          <>
            <Card>
              <CardContent className="p-4 text-sm">
                <span className="font-medium">Data coverage: </span>
                cost is known for {data.coverage.known_pct}% of {data.coverage.turns} turns
                {" · "}
                {data.coverage.by_basis.actual ?? 0} measured,{" "}
                {data.coverage.by_basis.estimated ?? 0} estimated,{" "}
                {data.coverage.by_basis.unknown ?? 0} unknown
              </CardContent>
            </Card>

            {data.alerts.length > 0 && (
              <Card className="border-destructive/40">
                <CardContent className="space-y-1 p-4 text-sm">
                  {data.alerts.map((a) => (
                    <div key={a} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <span>{a}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Credits charged", value: data.totals.credits_charged.toFixed(2) },
                { label: "Known variable cost", value: usd(data.totals.variable_cost_usd, 2) },
                { label: "Cost per credit", value: usd(data.totals.cost_per_credit_usd) },
                { label: "Target per credit", value: usd(data.totals.target_cost_per_credit_usd, 2) },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                    <div className="text-lg font-semibold">{s.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 text-sm font-medium">Builds</h2>
                <div className="text-sm text-muted-foreground">
                  {data.builds.total} total · {data.builds.ready} ready · {data.builds.failed} failed ·
                  p50 {secs(data.builds.p50_ms)} · p90 {secs(data.builds.p90_ms)} · p95{" "}
                  {secs(data.builds.p95_ms)}
                </div>
              </CardContent>
            </Card>

            {data.ai_rollup && (
              <Card>
                <CardContent className="p-4">
                  <h2 className="mb-2 text-sm font-medium">AI per turn</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Turns measured", value: String(data.ai_rollup.turns) },
                      { label: "AI calls / turn", value: data.ai_rollup.avg_calls_per_turn.toFixed(2) },
                      { label: "Input tokens / turn", value: data.ai_rollup.avg_input_tokens.toLocaleString() },
                      { label: "Output tokens / turn", value: data.ai_rollup.avg_output_tokens.toLocaleString() },
                      {
                        label: "Cache hit",
                        value: data.ai_rollup.cache_hit_pct === null ? "—" : `${data.ai_rollup.cache_hit_pct}%`,
                      },
                      { label: "Retries / turn", value: data.ai_rollup.retries_per_turn.toFixed(2) },
                      { label: "Call error rate", value: `${data.ai_rollup.error_rate_pct}%` },
                      { label: "Cost / turn", value: usd(data.ai_rollup.avg_cost_per_turn_usd) },
                    ].map((s) => (
                      <div key={s.label}>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                        <div className="text-lg font-semibold">{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {data.ai_rollup.calls_without_usage_pct}% of AI calls still report no token
                    usage — those are excluded from the token and cost figures above.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 text-sm font-medium">By feature</h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Feature</th>
                      <th>Turns</th>
                      <th>Credits</th>
                      <th>Known cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.by_feature).map(([f, v]) => (
                      <tr key={f} className="border-t">
                        <td className="py-1">{f}</td>
                        <td>{v.turns}</td>
                        <td>{v.credits.toFixed(2)}</td>
                        <td>{usd(v.cost, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 text-sm font-medium">By model</h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Provider / model</th>
                      <th>Calls</th>
                      <th>Recorded cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.by_model)
                      .sort((a, z) => z[1].cost - a[1].cost)
                      .slice(0, 15)
                      .map(([m, v]) => (
                        <tr key={m} className="border-t">
                          <td className="py-1">{m}</td>
                          <td>{v.calls}</td>
                          <td>{usd(v.cost, 4)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 text-sm font-medium">Most expensive projects</h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Project</th>
                      <th>Turns</th>
                      <th>Credits</th>
                      <th>Known cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_projects.map((p) => (
                      <tr key={p.project_id} className="border-t">
                        <td className="py-1 font-mono text-xs">{p.project_id.slice(0, 8)}</td>
                        <td>{p.turns}</td>
                        <td>{p.credits.toFixed(2)}</td>
                        <td>{usd(p.cost, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        <EconomicsConfigPanel />
      </div>
    </div>
  );
}

/* --------------------------- Editable settings --------------------------- */

type ConfigRow = {
  key: string;
  value: number;
  default_value: number;
  overridden: boolean;
};

const CONFIG_LABELS: Record<string, string> = {
  target_variable_cost_per_credit_usd: "Target variable cost per credit (USD)",
  build_minute_usd: "Build minute (USD)",
  verification_minute_usd: "Verification minute (USD)",
  deploy_event_usd: "Deploy event (USD)",
  image_generation_usd: "Image generation (USD)",
  min_purchase_usd_cents: "Minimum credit purchase (USD cents)",
  target_gross_margin_pct: "Target gross margin (%)",
  free_user_monthly_cost_ceiling_usd: "Free user monthly cost ceiling (USD)",
  max_active_dedicated_backends: "Max active dedicated backends",
  dedicated_retention_days: "Dedicated backend retention (days)",
  auto_upgrade_row_pct: "Auto-upgrade at rows used (%)",
  auto_upgrade_user_count: "Auto-upgrade at app users",
  auto_upgrade_min_credits: "Auto-upgrade minimum credits",
  compute_hour_usd: "Kimble Compute per awake hour (USD)",
  max_active_compute: "Max active compute containers",
};

function EconomicsConfigPanel() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await adminApi<{ rows: ConfigRow[] }>({ action: "economics_config" });
      setRows(res.rows);
      setDrafts(Object.fromEntries(res.rows.map((r) => [r.key, String(r.value)])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: string) {
    const value = Number(drafts[key]);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a positive number");
      return;
    }
    setBusy(key);
    try {
      await adminApi({ action: "set_economics_config", key, value });
      toast.success("Saved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function reset(key: string) {
    setBusy(key);
    try {
      await adminApi({ action: "reset_economics_config", key });
      toast.success("Reset to default");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-medium">Economics settings</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Internal cost and margin rates used across billing, Cloud metering and auto-upgrades.
          Customer prices live on the Billing tab (plans, credit packs, currencies).
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-2 border-t py-2">
                <div className="min-w-[16rem] flex-1">
                  <div className="text-sm">{CONFIG_LABELS[r.key] ?? r.key}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {r.key} · default {r.default_value}
                    {r.overridden ? " · overridden" : ""}
                  </div>
                </div>
                <Input
                  className="w-36"
                  type="number"
                  step="any"
                  min="0"
                  value={drafts[r.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                />
                <Button size="sm" disabled={busy === r.key} onClick={() => void save(r.key)}>
                  Save
                </Button>
                {r.overridden && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === r.key}
                    onClick={() => void reset(r.key)}
                  >
                    Reset
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
