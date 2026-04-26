/**
 * The warm, story-like activity feed users see while Petal builds their app.
 * Replaces the old "Thinking… / Writing project… / Applying changes…" line.
 *
 * Renders inside the chat thread. Self-contained — no app state, just props.
 * Auto-collapses to a single success line a few seconds after going live.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCcw, Wrench, X, Square } from "lucide-react";
import { type Phase, type PhaseId, totalElapsedSeconds } from "@/lib/build-phases";
import type { FriendlyError } from "@/lib/friendly-errors";

type Props = {
  phases: Phase[];
  /** True while either generation or deployment is in flight. */
  isActive: boolean;
  /** True once everything finished successfully (build is live). */
  isComplete: boolean;
  /** Friendly error if anything failed. */
  error: FriendlyError | null;
  /** Live caption shown under the "Designing" phase as the AI summary streams. */
  designCaption?: string;
  /** Latest file written, shown next to the file counter. */
  latestPath?: string;
  /** Number of files written so far (during the writing phase). */
  filesWritten?: number;
  /** Ordered list of every file path written so far (deduped). */
  writtenPaths?: string[];
  /** After completion, final line counts keyed by path — drives the "X lines" badge. */
  finalFileLines?: Record<string, number>;
  onStop?: () => void;
  onRetry?: () => void;
  onAskFix?: () => void;
  onDismissError?: () => void;
};

export function BuildActivityCard({
  phases,
  isActive,
  isComplete,
  error,
  designCaption,
  latestPath,
  filesWritten,
  writtenPaths,
  finalFileLines,
  onStop,
  onRetry,
  onAskFix,
  onDismissError,
}: Props) {
  // Auto-collapse 3s after success.
  const [collapsed, setCollapsed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    if (!isComplete || error) return;
    const t = setTimeout(() => setCollapsed(true), 3000);
    return () => clearTimeout(t);
  }, [isComplete, error]);

  const elapsed = useMemo(() => totalElapsedSeconds(phases), [phases]);

  // Tick once a second while active so the elapsed counter and
  // "this is taking a while" reassurance update in real time.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  // ─── Collapsed success state ─────────────────────────────────────────────
  if (collapsed && isComplete && !error) {
    return (
      <div className="mr-6 flex items-center justify-between rounded-2xl border border-mint/60 bg-mint/30 px-3.5 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
          <span aria-hidden>🌟</span>
          Your app is live · built in {elapsed}s
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          show steps
        </button>
      </div>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="mr-6 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-3.5 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/30">
        <div className="flex items-start gap-2.5">
          <span className="text-base leading-none" aria-hidden>
            {error.actionKind === "ask-fix" ? "🔧" : "😅"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-tight text-foreground">{error.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {error.message}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {error.actionKind === "retry" && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition hover:opacity-90"
                >
                  <RefreshCcw className="h-3 w-3" />
                  {error.actionLabel}
                </button>
              )}
              {error.actionKind === "ask-fix" && onAskFix && (
                <button
                  type="button"
                  onClick={onAskFix}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition hover:opacity-90"
                >
                  <Wrench className="h-3 w-3" />
                  {error.actionLabel}
                </button>
              )}
              {error.actionKind === "dismiss" && onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  {error.actionLabel}
                </button>
              )}
              {error.technicalDetail && (
                <button
                  type="button"
                  onClick={() => setShowDetails((s) => !s)}
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {showDetails ? "Hide details" : "Show details"}
                </button>
              )}
            </div>
            {showDetails && error.technicalDetail && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/60 bg-card/60 p-2 text-[10px] leading-snug text-muted-foreground">
                {error.technicalDetail}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Default: live activity feed ────────────────────────────────────────
  return (
    <div className="mr-6 overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm backdrop-blur transition-all">
      <div className="flex items-center justify-between border-b border-border/60 bg-aurora/40 px-3.5 py-2">
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/70">
          <span className="relative flex h-2 w-2">
            {isActive && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isActive ? "bg-primary" : "bg-mint"
              }`}
            />
          </span>
          {isComplete ? "Done" : "Petal is building"}
          {elapsed > 0 && (
            <span className="font-mono text-[10px] font-normal text-muted-foreground">
              · {elapsed}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isActive && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Square className="h-2.5 w-2.5 fill-current" /> Stop
            </button>
          )}
          {isComplete && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:text-foreground"
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      <ol className="space-y-1 px-3.5 py-2.5">
        {phases.map((p) => (
          <PhaseRow
            key={p.id}
            phase={p}
            designCaption={p.id === "designing" ? designCaption : undefined}
            filesWritten={p.id === "writing" ? filesWritten : undefined}
            latestPath={p.id === "writing" ? latestPath : undefined}
          />
        ))}
      </ol>
    </div>
  );
}

function PhaseRow({
  phase,
  designCaption,
  filesWritten,
  latestPath,
}: {
  phase: Phase;
  designCaption?: string;
  filesWritten?: number;
  latestPath?: string;
}) {
  const isPending = phase.status === "pending";
  const isActive = phase.status === "active";
  const isDone = phase.status === "done";
  const isFailed = phase.status === "failed";

  // Show reassurance after 10s on the active phase.
  const showReassurance = isActive && phase.startedAt && Date.now() - phase.startedAt > 10000;

  // Build the per-phase headline. For "writing", inject the file counter.
  let headline = isDone ? phase.doneLabel : phase.label;
  if (phase.id === "writing" && (isActive || isDone) && filesWritten && filesWritten > 0) {
    headline = isDone
      ? `Wrote ${filesWritten} file${filesWritten === 1 ? "" : "s"}`
      : `Writing your app… (${filesWritten} file${filesWritten === 1 ? "" : "s"} so far)`;
  }

  return (
    <li className="flex items-start gap-2.5 text-sm leading-snug">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-[13px] transition-opacity ${
          isPending ? "opacity-30" : "opacity-100"
        } ${isActive ? "animate-pulse" : ""}`}
        aria-hidden
      >
        {isDone ? "✓" : isFailed ? "✕" : phase.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`flex items-baseline justify-between gap-2 ${
            isPending ? "text-muted-foreground/60" : "text-foreground"
          } ${isDone ? "text-muted-foreground" : ""}`}
        >
          <span className="truncate">{headline}</span>
        </div>
        {isActive && phase.id === "designing" && designCaption && (
          <div className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
            {designCaption}
          </div>
        )}
        {isActive && phase.id === "writing" && latestPath && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {latestPath}
          </div>
        )}
        {showReassurance && phase.reassurance && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{phase.reassurance}</div>
        )}
      </div>
    </li>
  );
}
