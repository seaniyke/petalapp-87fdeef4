/**
 * /admin/ai-providers — operator console for routing AI traffic between
 * Lovable AI (default) and OpenRouter, per Petal feature.
 *
 * Why this exists:
 *   Petal's biggest variable cost is AI tokens. Lovable AI is convenient
 *   (auto-provisioned key, free monthly credits) but priced per token. For
 *   the heavy code-generation feature ("generate") this can dominate the
 *   bill at scale. OpenRouter is a cheaper, OpenAI-compatible alternative.
 *
 *   This page lets the operator (admin) flip providers per feature WITHOUT
 *   redeploying or editing secrets. Changes take effect within ~30s globally
 *   (the helper invalidates its in-memory cache on every save).
 *
 * Safety:
 *   - Image generation is hard-pinned to Lovable AI and shown as locked
 *     (uses Gemini's nano-banana response shape that OpenRouter doesn't match).
 *   - If OPENROUTER_API_KEY is not configured, OpenRouter rows are disabled
 *     with a clear message.
 *   - All writes are admin-gated server-side; client-side guard is just UX.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ExternalLink,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import {
  listAiProviderSettings,
  setAiProviderSetting,
  type AiFeatureRow,
} from "@/server/ai-provider.functions";
import type { AiFeature } from "@/server/ai-provider.server";

export const Route = createFileRoute("/admin/ai-providers")({
  head: () => ({
    meta: [
      { title: "Admin · AI Providers" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AiProvidersPage,
});

const FEATURE_DETAILS: Record<AiFeature, { label: string; blurb: string }> = {
  generate: {
    label: "Code generation",
    blurb: "The big one — every Build turn. Where most of your AI cost lives.",
  },
  discuss: {
    label: "Discuss / Plan mode",
    blurb: "Chat replies that don't touch files. One non-streaming call per turn.",
  },
  triage: {
    label: "Triage (warm reply)",
    blurb: "The instant 'hi' before Build runs. Cheap, latency-sensitive.",
  },
  coach: {
    label: "Idea Coach",
    blurb: "The 'I don't know what to build' guided dialogue.",
  },
  design: {
    label: "Design Director",
    blurb: "Picks a bold visual direction at the start of a project.",
  },
  memory: {
    label: "Project Memory writer",
    blurb: "Background tagger that remembers facts about each project.",
  },
  recovery: {
    label: "Self-recovery",
    blurb: "Post-build self-check + friendly error humanizer.",
  },
  preflight: {
    label: "Pre-flight estimate",
    blurb: "Cheap classifier that previews cost/time before you hit send.",
  },
  image: {
    label: "Image generation",
    blurb: "Nano-banana / Gemini image gen. Locked to Lovable AI.",
  },
};

function AiProvidersPage() {
  const { ready } = useAdminGuard("/admin/ai-providers");
  const list = useServerFn(listAiProviderSettings);
  const setOne = useServerFn(setAiProviderSetting);

  const [rows, setRows] = useState<AiFeatureRow[] | null>(null);
  const [openrouterReady, setOpenrouterReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingFeature, setSavingFeature] = useState<AiFeature | null>(null);

  const refresh = async () => {
    try {
      const res = await list();
      setRows(res.rows);
      setOpenrouterReady(res.openrouterKeyConfigured);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load provider settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const onChange = async (feature: AiFeature, choice: "lovable" | "openrouter" | "auto") => {
    setSavingFeature(feature);
    try {
      const provider = choice === "auto" ? null : choice;
      await setOne({ data: { feature, provider } });
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
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
            Pick which provider serves each feature. Changes propagate within ~30 seconds.
          </p>
        </div>

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
                {openrouterReady
                  ? "OpenRouter key is configured."
                  : "OpenRouter key not configured."}
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
                onChange={(choice) => onChange(row.feature, choice)}
              />
            ))}
          </div>
        )}

        {/* Footer help */}
        <Card className="mt-8 border-border/60">
          <CardContent className="p-5 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 text-foreground">
              <Sparkles className="h-4 w-4" />
              <span className="font-medium">Recommended setup</span>
            </div>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                Send <strong>Code generation</strong> to OpenRouter — that's where 80%+ of your
                AI cost lives.
              </li>
              <li>
                Keep <strong>Triage</strong> and <strong>Discuss</strong> on Lovable AI — they're
                cheap and latency-sensitive.
              </li>
              <li>
                <strong>Image generation</strong> stays on Lovable AI; it relies on Gemini's
                nano-banana response shape.
              </li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function FeatureRow({
  row,
  openrouterReady,
  saving,
  onChange,
}: {
  row: AiFeatureRow;
  openrouterReady: boolean;
  saving: boolean;
  onChange: (choice: "lovable" | "openrouter" | "auto") => void;
}) {
  const details = FEATURE_DETAILS[row.feature];
  const current: "lovable" | "openrouter" | "auto" = row.override ?? "auto";

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
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
            onClick={() => onChange("auto")}
          >
            Auto
          </SegBtn>
          <SegBtn
            active={current === "lovable"}
            disabled={row.locked || saving}
            onClick={() => onChange("lovable")}
          >
            Lovable
          </SegBtn>
          <SegBtn
            active={current === "openrouter"}
            disabled={row.locked || saving || !openrouterReady}
            onClick={() => onChange("openrouter")}
            title={!openrouterReady ? "Add OPENROUTER_API_KEY first" : undefined}
          >
            OpenRouter
          </SegBtn>
          {saving && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
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

// Suppress unused import warning — Button reserved for future use.
void Button;
