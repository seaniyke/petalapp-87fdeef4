/**
 * Cloud / AI usage sub-view. Mirrors Lovable's "AI usage" mobile screen:
 *  - Period selector (Last 7 / 30 / 90 days)
 *  - "AI connection · Active" pill + Total requests / # models / Top model
 *  - Stacked bar chart by day, segmented by model
 *  - Models leaderboard (model, calls)
 *
 * Data is admin-gated and workspace-wide because ai_call_log doesn't carry
 * a user_id. Non-admins see a friendly empty state.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useServerFn } from "@tanstack/react-start";
import { getAiUsage, type AiUsageResult } from "@/lib/cloud-ai-usage.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PERIOD_OPTIONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

// Distinct, accessible-ish bar colors. Cycled when more models than colors.
const MODEL_COLORS = [
  "hsl(217 91% 60%)", // blue
  "hsl(330 81% 60%)", // pink
  "hsl(262 83% 58%)", // purple
  "hsl(173 80% 40%)", // teal
  "hsl(38 92% 50%)", // amber
  "hsl(0 84% 60%)", // red
  "hsl(142 76% 36%)", // green
];

export function CloudAiUsageView() {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AiUsageResult | null>(null);
  const fetchUsage = useServerFn(getAiUsage);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUsage({ data: { days } })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        console.error("[CloudAiUsageView] fetch failed", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, fetchUsage]);

  // Build chart data: array of { day, [model1]: count, [model2]: count, ... }
  const chartData = useMemo(() => {
    if (!result) return [];
    return result.series.map((row) => ({
      day: formatShortDay(row.day),
      ...row.byModel,
    }));
  }, [result]);

  const modelKeys = useMemo(
    () => result?.models.map((m) => m.model) ?? [],
    [result],
  );

  return (
    <div className="space-y-5 p-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">AI usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View AI usage over time.
        </p>
      </div>

      <Select
        value={String(days)}
        onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}
      >
        <SelectTrigger className="w-40 rounded-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !result?.authorized ? (
        <div className="rounded-2xl bg-muted/40 p-6 text-sm text-muted-foreground">
          AI usage analytics are workspace-wide and only visible to workspace
          admins right now.
        </div>
      ) : result.totalRequests === 0 ? (
        <div className="rounded-2xl bg-muted/40 p-6 text-sm text-muted-foreground">
          No AI calls in the {PERIOD_OPTIONS.find((p) => p.value === days)?.label.toLowerCase()}.
        </div>
      ) : (
        <>
          {/* Summary card */}
          <div className="space-y-4 rounded-2xl bg-muted/40 p-5">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">AI connection</h3>
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Active
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total requests" value={result.totalRequests.toLocaleString()} />
              <Stat label="Number of models" value={String(result.modelCount)} />
              <Stat
                label="Top model"
                value={result.topModel ? shortModelName(result.topModel) : "—"}
                tight
              />
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-2xl bg-muted/40 p-3">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  {modelKeys.map((model, i) => (
                    <Bar
                      key={model}
                      dataKey={model}
                      stackId="calls"
                      fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                      radius={i === modelKeys.length - 1 ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Models table */}
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">Models</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              View which AI models are being used in your app.
            </p>
            <div className="mt-3 overflow-hidden rounded-2xl bg-muted/40">
              <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-muted-foreground">
                <div>Model</div>
                <div>Calls</div>
              </div>
              {result.models.map((m, i) => (
                <div
                  key={m.model}
                  className={`grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm ${
                    i < result.models.length - 1 ? "border-b border-border/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-background text-[11px] font-semibold text-muted-foreground"
                      aria-hidden
                    >
                      {providerLetter(m.provider)}
                    </span>
                    <span className="truncate font-medium">{shortModelName(m.model)}</span>
                  </div>
                  <div className="tabular-nums">{m.calls.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tight }: { label: string; value: string; tight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate font-semibold ${tight ? "text-sm" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function formatShortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortModelName(model: string): string {
  // "google/gemini-3-flash-preview" -> "gemini-3-flash-preview"
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function providerLetter(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes("google") || p.includes("gemini")) return "G";
  if (p.includes("openai") || p.includes("gpt")) return "O";
  if (p.includes("anthropic") || p.includes("claude")) return "A";
  return p[0]?.toUpperCase() ?? "•";
}
