/**
 * AnalyticsSheet — traffic for the project's published site.
 *
 * Reads the same database-backed visitor counts the publish sheet uses
 * (/api/visitors), with a 24h / 7d / 30d range switch. Soft-fails: when the
 * upstream analytics call is unavailable we render a dash rather than a zero
 * so we never claim "no traffic" when we simply couldn't read it.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BarChart3, Loader2, RefreshCw, Rocket } from "lucide-react";
import { fetchProjectVisitors, type VisitorRange } from "@/lib/visitors";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Published URL, when the project has shipped at least once. */
  liveUrl?: string | null;
  onPublish?: () => void;
};

const RANGES: { value: VisitorRange; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function AnalyticsSheet({
  open,
  onOpenChange,
  projectId,
  liveUrl,
  onPublish,
}: Props) {
  const [range, setRange] = useState<VisitorRange>("7d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    visitors: number;
    pageviews: number;
    unavailable: boolean;
    neverPublished: boolean;
  } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchProjectVisitors({ projectId, range, signal });
        if (signal?.aborted) return;
        setStats({
          visitors: result.visitors,
          pageviews: result.pageviews,
          unavailable: result.unavailable,
          neverPublished: !!result.neverPublished,
        });
      } catch (e) {
        if (signal?.aborted) return;
        setError(e instanceof Error ? e.message : "Couldn't load analytics");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId, range],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  const unknown = !stats || stats.unavailable;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Analytics
          </SheetTitle>
          <SheetDescription>
            Visitors and pageviews for your published site.
          </SheetDescription>
        </SheetHeader>

        {stats?.neverPublished ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-muted/30 p-6 text-center">
            <Rocket className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-3 text-sm font-semibold">Not published yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Publish your app and traffic starts showing up here.
            </p>
            {onPublish && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onPublish();
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-105"
              >
                <Rocket className="h-4 w-4" /> Publish now
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    range === r.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat
                label="Visitors"
                value={unknown ? "—" : stats!.visitors.toLocaleString()}
                loading={loading}
              />
              <Stat
                label="Pageviews"
                value={unknown ? "—" : stats!.pageviews.toLocaleString()}
                loading={loading}
              />
            </div>

            {stats?.unavailable && (
              <p className="mt-3 text-xs text-muted-foreground">
                Traffic data is temporarily unavailable. Try again in a moment.
              </p>
            )}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </button>
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  View live site
                </a>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
      </div>
    </div>
  );
}
