/**
 * /admin/ai-providers — operator console for AI routing.
 *
 * Per feature you can choose:
 *   - Provider (Auto / Lovable / OpenRouter)
 *   - Primary model (free text, validated server-side)
 *   - Fallback model (retried once on 429/402/5xx)
 *
 * Plus a 7-day cost & usage rollup at the top.
 *
 * Image gen is hard-pinned to Lovable AI and shown as locked.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ExternalLink,
  Save,
  RefreshCw,
} from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type {
  AiFeatureRow,
  AiCostRow,
  SetProviderInput,
} from "@/server/ai-provider-admin.server";
import type { AiFeature } from "@/server/ai-provider.server";

/**
 * Call the admin API with the user's Supabase access token. We use a plain
 * fetch (not `useServerFn`) because TanStack's `createServerFn` does NOT
 * forward the Supabase bearer token — see `routes/api/admin/ai-providers.ts`.
 */
async function callAdminApi<T>(
  action: "list" | "set" | "costs" | "router-snapshot" | "router-config",
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/admin/ai-providers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const Route = createFileRoute("/admin/ai-providers")({
  head: () => ({
    meta: [
      { title: "Admin · AI Providers" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AiProvidersPage,
});

const FEATURE_DETAILS: Record<AiFeature, { label: string; blurb: string; recommended: { lovable: string; openrouter: string }; fallback: string }> = {
  generate: {
    label: "Code generation",
    blurb: "The big one — every Build turn. Where most of your AI cost lives.",
    recommended: { lovable: "google/gemini-2.5-pro", openrouter: "anthropic/claude-sonnet-4.5" },
    fallback: "openai/gpt-5-mini",
  },
  discuss: {
    label: "Discuss / Plan mode",
    blurb: "Chat replies that don't touch files. Cheap-friendly.",
    recommended: { lovable: "google/gemini-2.5-flash", openrouter: "deepseek/deepseek-chat-v3" },
    fallback: "google/gemini-2.5-flash",
  },
  triage: {
    label: "Triage (warm reply)",
    blurb: "The instant 'hi' before Build. Tool-call reliability matters.",
    recommended: { lovable: "google/gemini-2.5-flash", openrouter: "openai/gpt-5-mini" },
    fallback: "anthropic/claude-haiku-4.5",
  },
  coach: {
    label: "Idea Coach",
    blurb: "The 'I don't know what to build' guided dialogue.",
    recommended: { lovable: "google/gemini-2.5-flash", openrouter: "deepseek/deepseek-chat-v3" },
    fallback: "google/gemini-2.5-flash",
  },
  design: {
    label: "Design Director",
    blurb: "Picks a bold visual direction at the start of a project.",
    recommended: { lovable: "google/gemini-2.5-pro", openrouter: "anthropic/claude-sonnet-4.5" },
    fallback: "openai/gpt-5-mini",
  },
  memory: {
    label: "Project Memory writer",
    blurb: "Background tagger. Pure summarisation — go cheap.",
    recommended: { lovable: "google/gemini-2.5-flash-lite", openrouter: "google/gemini-2.5-flash-lite" },
    fallback: "google/gemini-2.5-flash",
  },
  recovery: {
    label: "Self-recovery",
    blurb: "Post-build self-check. Debugging quality matters.",
    recommended: { lovable: "google/gemini-2.5-pro", openrouter: "anthropic/claude-sonnet-4.5" },
    fallback: "openai/gpt-5-mini",
  },
  preflight: {
    label: "Pre-flight estimate",
    blurb: "Cheap classifier that previews cost/time before you hit send.",
    recommended: { lovable: "google/gemini-2.5-flash-lite", openrouter: "google/gemini-2.5-flash-lite" },
    fallback: "google/gemini-2.5-flash",
  },
  image: {
    label: "Image generation",
    blurb: "Nano-banana / Gemini image gen. Locked to Lovable AI.",
    recommended: { lovable: "google/gemini-2.5-flash-image", openrouter: "google/gemini-2.5-flash-image" },
    fallback: "",
  },
};

function formatUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(5)}`;
}

function AiProvidersPage() {
  const { ready } = useAdminGuard("/admin/ai-providers");

  const [rows, setRows] = useState<AiFeatureRow[] | null>(null);
  const [openrouterReady, setOpenrouterReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingFeature, setSavingFeature] = useState<AiFeature | null>(null);

  const [costLoading, setCostLoading] = useState(false);
  const [costRows, setCostRows] = useState<AiCostRow[] | null>(null);
  const [costTotals, setCostTotals] = useState<{ calls: number; cost: number; errors: number }>({
    calls: 0,
    cost: 0,
    errors: 0,
  });

  const refresh = async () => {
    try {
      const res = await callAdminApi<{
        rows: AiFeatureRow[];
        openrouterKeyConfigured: boolean;
      }>("list");
      setRows(res.rows);
      setOpenrouterReady(res.openrouterKeyConfigured);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to load provider settings");
    } finally {
      setLoading(false);
    }
  };

  const refreshCost = async () => {
    setCostLoading(true);
    try {
      const res = await callAdminApi<{
        rows: AiCostRow[];
        totalCalls: number;
        totalCostUsdMicro: number;
        totalErrors: number;
      }>("costs", { days: 7 });
      setCostRows(res.rows);
      setCostTotals({
        calls: res.totalCalls,
        cost: res.totalCostUsdMicro,
        errors: res.totalErrors,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setCostLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    void refresh();
    void refreshCost();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const onProviderChange = async (
    feature: AiFeature,
    choice: "lovable" | "openrouter" | "auto",
  ) => {
    setSavingFeature(feature);
    try {
      const provider = choice === "auto" ? null : choice;
      const input: SetProviderInput = { feature, provider };
      await callAdminApi<{ ok: true }>("set", { input });
      toast.success(
        choice === "auto"
          ? `${FEATURE_DETAILS[feature].label}: cleared override`
          : `${FEATURE_DETAILS[feature].label} → ${choice === "openrouter" ? "OpenRouter" : "Lovable AI"}`,
      );
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingFeature(null);
    }
  };

  const onModelSave = async (
    feature: AiFeature,
    model: string,
    fallbackModel: string,
  ) => {
    setSavingFeature(feature);
    try {
      const input: SetProviderInput = {
        feature,
        provider: rows?.find((r) => r.feature === feature)?.override ?? null,
        model: model.trim() || null,
        fallbackModel: fallbackModel.trim() || null,
      };
      await callAdminApi<{ ok: true }>("set", { input });
      toast.success(`${FEATURE_DETAILS[feature].label}: model saved`);
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingFeature(null);
    }
  };

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
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Admin
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">AI Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick provider + model per feature. Changes propagate within ~30 seconds.
          </p>
        </div>

        {/* Cost rollup */}
        <CostDashboard
          rows={costRows}
          totals={costTotals}
          loading={costLoading}
          onRefresh={refreshCost}
        />

        {/* Tier 4 — Smart router */}
        <SmartRouterCard />

        {/* OpenRouter status banner */}
        <Card
          className={`mb-6 border ${
            openrouterReady ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          <CardContent className="flex items-start gap-3 p-4">
            {openrouterReady ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
            )}
            <div className="flex-1 text-sm">
              <p className="font-medium">
                {openrouterReady ? "OpenRouter key is configured." : "OpenRouter key not configured."}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {openrouterReady ? (
                  <>You can switch any feature to OpenRouter below.</>
                ) : (
                  <>
                    Add <code className="rounded bg-muted px-1 py-0.5 text-xs">OPENROUTER_API_KEY</code>{" "}
                    in Cloud → Secrets, then refresh this page.
                  </>
                )}
              </p>
            </div>
            <a
              href="https://openrouter.ai/activity"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              OpenRouter usage <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>

        {/* Features list */}
        {loading || !rows ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading features…
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <FeatureRow
                key={row.feature}
                row={row}
                openrouterReady={openrouterReady}
                saving={savingFeature === row.feature}
                onProviderChange={(choice) => onProviderChange(row.feature, choice)}
                onModelSave={(model, fallback) => onModelSave(row.feature, model, fallback)}
              />
            ))}
          </div>
        )}

        <Card className="mt-8 border-border/60">
          <CardContent className="p-5 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 text-foreground">
              <Sparkles className="h-4 w-4" />
              <span className="font-medium">Recommended setup (April 2026 benchmarks)</span>
            </div>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                <strong>Code generation</strong> → OpenRouter <code>anthropic/claude-sonnet-4.5</code>{" "}
                (best code + tool reliability), fallback <code>openai/gpt-5-mini</code>.
              </li>
              <li>
                <strong>Discuss / Coach</strong> → OpenRouter <code>deepseek/deepseek-chat-v3</code>{" "}
                (~20× cheaper than Sonnet, indistinguishable for chat).
              </li>
              <li>
                <strong>Triage</strong> → <code>openai/gpt-5-mini</code> — tool-call reliability matters more than cost.
              </li>
              <li>
                <strong>Memory / Preflight</strong> → <code>google/gemini-2.5-flash-lite</code> — pure classification.
              </li>
              <li>
                Always set a fallback model. The helper retries once on 429/402/5xx so
                OpenRouter outages don't break Petal.
              </li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CostDashboard({
  rows,
  totals,
  loading,
  onRefresh,
}: {
  rows: AiCostRow[] | null;
  totals: { calls: number; cost: number; errors: number };
  loading: boolean;
  onRefresh: () => void;
}) {
  const errorRate = totals.calls > 0 ? (totals.errors / totals.calls) * 100 : 0;
  return (
    <Card className="mb-6 border-border/60">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Last 7 days
            </h2>
            <div className="mt-1 flex items-baseline gap-6">
              <div>
                <div className="text-2xl font-semibold">{formatUsd(totals.cost)}</div>
                <div className="text-xs text-muted-foreground">Estimated cost</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{totals.calls.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Calls</div>
              </div>
              <div>
                <div
                  className={`text-2xl font-semibold ${
                    errorRate > 2 ? "text-amber-500" : ""
                  }`}
                >
                  {errorRate.toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground">Error rate</div>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {loading && !rows ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No AI calls logged yet. Telemetry starts after this update ships.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{r.feature}</td>
                    <td className="px-3 py-2">{r.provider}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {r.model || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{r.calls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.totalTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(r.costUsdMicro)}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        r.errorCalls > 0 ? "text-amber-500" : "text-muted-foreground"
                      }`}
                    >
                      {r.errorCalls}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Cost is estimated from token counts; OpenRouter exact billing is on{" "}
          <a
            href="https://openrouter.ai/activity"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            their dashboard
          </a>
          . Tokens may be 0 for streaming responses where usage isn't reported.
        </p>
      </CardContent>
    </Card>
  );
}

function FeatureRow({
  row,
  openrouterReady,
  saving,
  onProviderChange,
  onModelSave,
}: {
  row: AiFeatureRow;
  openrouterReady: boolean;
  saving: boolean;
  onProviderChange: (choice: "lovable" | "openrouter" | "auto") => void;
  onModelSave: (model: string, fallback: string) => void;
}) {
  const details = FEATURE_DETAILS[row.feature];
  const current: "lovable" | "openrouter" | "auto" = row.override ?? "auto";

  const recommendedModel = useMemo(
    () => details.recommended[row.effective] || "",
    [details, row.effective],
  );
  const recommendedFallback = details.fallback;

  const [modelDraft, setModelDraft] = useState(row.model ?? "");
  const [fallbackDraft, setFallbackDraft] = useState(row.fallbackModel ?? "");

  // Sync drafts when DB row changes (e.g. after refresh).
  useEffect(() => {
    setModelDraft(row.model ?? "");
    setFallbackDraft(row.fallbackModel ?? "");
  }, [row.model, row.fallbackModel]);

  const dirty = (modelDraft || "") !== (row.model || "") ||
    (fallbackDraft || "") !== (row.fallbackModel || "");

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium tracking-tight">{details.label}</h3>
              {row.locked && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              )}
              <ProviderBadge provider={row.effective} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{details.blurb}</p>
            {!row.locked && row.override === null && row.envChoice && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                Currently following env var (<code>{row.envChoice}</code>).
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-background p-1">
            <SegBtn
              active={current === "auto"}
              disabled={row.locked || saving}
              onClick={() => onProviderChange("auto")}
            >
              Auto
            </SegBtn>
            <SegBtn
              active={current === "lovable"}
              disabled={row.locked || saving}
              onClick={() => onProviderChange("lovable")}
            >
              Lovable
            </SegBtn>
            <SegBtn
              active={current === "openrouter"}
              disabled={row.locked || saving || !openrouterReady}
              onClick={() => onProviderChange("openrouter")}
              title={!openrouterReady ? "Add OPENROUTER_API_KEY first" : undefined}
            >
              OpenRouter
            </SegBtn>
            {saving && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {!row.locked && (
          <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Primary model
              </label>
              <Input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                placeholder={recommendedModel || "use caller default"}
                className="h-8 font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Recommended: <code>{recommendedModel}</code>
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Fallback model (retried once on error)
              </label>
              <Input
                value={fallbackDraft}
                onChange={(e) => setFallbackDraft(e.target.value)}
                placeholder={recommendedFallback || "no fallback"}
                className="h-8 font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Recommended: <code>{recommendedFallback}</code>
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              {dirty && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setModelDraft(row.model ?? "");
                    setFallbackDraft(row.fallbackModel ?? "");
                  }}
                  disabled={saving}
                >
                  Reset
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => onModelSave(modelDraft, fallbackDraft)}
                disabled={saving || !dirty}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save models
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SegBtn({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ProviderBadge({ provider }: { provider: "lovable" | "openrouter" }) {
  const isLovable = provider === "lovable";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
        isLovable
          ? "bg-primary/10 text-primary"
          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      }`}
    >
      {isLovable ? "Lovable" : "OpenRouter"}
    </span>
  );
}

type RouterModelStat = {
  model: string;
  calls: number;
  errors: number;
  successRate: number;
  medianCostMicro: number;
  p50LatencyMs: number;
  score: number;
  enoughData: boolean;
};

type RouterSnapshotResp = {
  config: {
    enabled: boolean;
    explorationPct: number;
    minSamples: number;
    windowHours: number;
  };
  builtAt: number;
  perFeaturePhase: Array<{ feature: string; phase: string; models: RouterModelStat[] }>;
};

function SmartRouterCard() {
  const [snap, setSnap] = useState<RouterSnapshotResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await callAdminApi<RouterSnapshotResp>("router-snapshot");
      setSnap(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async () => {
    if (!snap) return;
    setSaving(true);
    try {
      await callAdminApi("router-config", {
        config: { enabled: !snap.config.enabled },
      });
      toast.success(`Smart router ${!snap.config.enabled ? "enabled" : "disabled"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6 border-border/60">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <h2 className="font-display text-lg font-semibold">Smart Router (Tier 4)</h2>
              {snap && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    snap.config.enabled
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {snap.config.enabled ? "ON" : "OFF"}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Picks the best model per (feature, phase) from telemetry. ε-greedy
              exploration: {snap?.config.explorationPct ?? 10}% • min samples:{" "}
              {snap?.config.minSamples ?? 20} • window: {snap?.config.windowHours ?? 168}h
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={toggle} disabled={saving || !snap}>
              {snap?.config.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !snap || snap.perFeaturePhase.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No telemetry yet. The router needs a few generations to start scoring models.
          </p>
        ) : (
          <div className="space-y-3">
            {snap.perFeaturePhase.map((row) => (
              <div key={`${row.feature}|${row.phase}`} className="rounded-md border border-border/60 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {row.feature} · {row.phase}
                </div>
                <div className="space-y-1.5">
                  {row.models.map((m, i) => (
                    <div
                      key={m.model}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        {i === 0 && m.enoughData && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            BEST
                          </span>
                        )}
                        {!m.enoughData && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            sampling
                          </span>
                        )}
                        <code className="truncate">{m.model}</code>
                      </div>
                      <div className="flex shrink-0 gap-3 text-muted-foreground">
                        <span>{(m.successRate * 100).toFixed(0)}% ok</span>
                        <span>{m.calls} calls</span>
                        <span>{(m.p50LatencyMs / 1000).toFixed(1)}s</span>
                        <span className="font-mono text-foreground">{m.score.toFixed(3)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
