/**
 * The compact build card users see in the chat thread while (and after)
 * Petal builds their app.
 *
 * Chat-level UI stays tiny on purpose: a status/summary line plus two
 * actions — "Details" (opens the full Timeline / Changes trace) and
 * "Preview" (jumps to the live app). Everything verbose lives in
 * <BuildDetailsSheet />.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Palette,
  FileEdit,
  Wand2,
  Rocket,
  CheckCircle2,
  Loader2,
  ListTree,
  Play,
  type LucideIcon,
} from "lucide-react";
import { type Phase, type PhaseId, totalElapsedSeconds } from "@/lib/build-phases";
import { formatDuration, type ThoughtTick } from "@/lib/build-trace";

import { pathToNarration } from "@/lib/path-narration";
import type { FriendlyError } from "@/lib/friendly-errors";
import { PetalErrorCard } from "@/components/PetalErrorCard";
import { BuildDetailsSheet, type FileChange } from "@/components/BuildDetailsSheet";

/**
 * One entry in the real-time build pipeline timeline.
 * Mirrors the `timeline` SSE event shape emitted by /api/generate.
 */
export type TimelineEntry = {
  step:
    | "stream_autofix"
    | "local_verifier"
    | "npm_preflight"
    | "continuation"
    | "esbuild_parse"
    | "render_risk"
    | "rls_sanity"
    | "file_budget"
    | "post_stream_autofix"
    | "image_resolve";
  outcome: "ok" | "fixed" | "skipped" | "failed";
  message: string;
  count?: number;
  ts: number;
};

const PHASE_ICONS: Record<PhaseId, LucideIcon> = {
  thinking: Sparkles,
  designing: Palette,
  writing: FileEdit,
  polishing: Wand2,
  deploying: Rocket,
  live: CheckCircle2,
};

type Props = {
  phases: Phase[];
  /** True while either generation or deployment is in flight. */
  isActive: boolean;
  /** True once everything finished successfully (build is live). */
  isComplete: boolean;
  /** Friendly error if anything failed. */
  error: FriendlyError | null;
  /** Live caption shown as the AI design summary streams. */
  designCaption?: string;
  /** Latest file written. */
  latestPath?: string;
  /** Model-written one-liner for the file currently being written. */
  latestNarration?: string;
  /** Most recent agentic-loop progress string. */
  latestCycleProgress?: string;
  /** Number of files written so far. */
  filesWritten?: number;
  /** Ordered list of every file path written so far (deduped). */
  writtenPaths?: string[];
  /** Paths whose stream-time `"content"` string finished. */
  completedPaths?: Set<string>;
  /** Final line counts keyed by path. */
  finalFileLines?: Record<string, number>;
  /** Per-file change kind + line delta vs. the pre-run snapshot. */
  fileChanges?: Record<string, FileChange>;
  /** Seconds we've been waiting on the deploy phase. */
  deployElapsedSec?: number;
  /** Live pipeline timeline pushed by the server. */
  timelineEvents?: TimelineEntry[];
  /** Credits actually charged for this turn. */
  creditsCharged?: number | null;
  onStop?: () => void;
  onRetry?: () => void;
  onAskFix?: () => void;
  onDismissError?: () => void;
  onBuyCredits?: () => void;
  /** Opens the per-file diff drawer. */
  onReviewChanges?: () => void;
  /** Jumps the workspace to the live preview. */
  onOpenPreview?: () => void;
};

export function BuildActivityCard({
  phases,
  isActive,
  isComplete,
  error,
  designCaption,
  latestPath,
  latestNarration,
  latestCycleProgress,
  filesWritten,
  writtenPaths,
  completedPaths,
  finalFileLines,
  fileChanges,
  deployElapsedSec,
  timelineEvents,
  creditsCharged,
  onRetry,
  onAskFix,
  onDismissError,
  onBuyCredits,
  onReviewChanges,
  onOpenPreview,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const elapsed = useMemo(() => totalElapsedSeconds(phases), [phases]);

  // Tick once a second while active so the elapsed counter updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  // Rolling "thinking log" — ring buffer of the last few narration lines,
  // timestamped so the details trace can roll them into "Thought for Ns".
  const [thinkingLog, setThinkingLog] = useState<ThoughtTick[]>([]);
  useEffect(() => {
    const text = (latestNarration ?? latestCycleProgress ?? "").trim();
    if (!text) return;
    setThinkingLog((prev) => {
      if (prev[prev.length - 1]?.text === text) return prev;
      return [...prev, { id: (prev[prev.length - 1]?.id ?? 0) + 1, text, ts: Date.now() }].slice(-24);
    });
  }, [latestNarration, latestCycleProgress]);
  useEffect(() => {
    if (!isActive && !isComplete) setThinkingLog([]);
  }, [isActive, isComplete]);

  // First time we saw each file stream in — gives the trace a real clock so
  // edits interleave with thoughts instead of being bolted on at the end.
  const [fileTimestamps, setFileTimestamps] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!writtenPaths?.length) return;
    setFileTimestamps((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of writtenPaths) {
        if (next[p] == null) {
          next[p] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [writtenPaths]);


  const currentPhase: Phase =
    phases.find((p) => p.status === "active") ??
    [...phases].reverse().find((p) => p.status === "done") ??
    phases[0];

  // Sub-caption under the headline.
  let subCaption: string | undefined;
  if (currentPhase?.id === "designing" && designCaption) {
    subCaption = designCaption;
  } else if (currentPhase?.id === "writing") {
    const modelLine = latestNarration?.trim();
    const derived = pathToNarration(latestPath);
    if (modelLine) subCaption = modelLine;
    else if (derived) subCaption = derived;
    else if (latestCycleProgress) subCaption = latestCycleProgress;
    else if (filesWritten && filesWritten > 0)
      subCaption = `${filesWritten} file${filesWritten === 1 ? "" : "s"} so far`;
  } else if (currentPhase?.id === "deploying" && typeof deployElapsedSec === "number") {
    if (deployElapsedSec >= 90) {
      subCaption = "Still on it — your code is safe, keep editing.";
    } else if (deployElapsedSec >= 60) {
      subCaption = "Almost there — bundling and uploading assets.";
    } else if (deployElapsedSec >= 30) {
      subCaption = "Wrapping up the build…";
    }
  } else if (
    isActive &&
    currentPhase?.startedAt &&
    Date.now() - currentPhase.startedAt > 10000 &&
    currentPhase.reassurance
  ) {
    subCaption = currentPhase.reassurance;
  }
  if (
    isActive &&
    latestCycleProgress &&
    (!subCaption || currentPhase?.id === "thinking" || currentPhase?.id === "polishing")
  ) {
    subCaption = latestCycleProgress;
  }

  // ─── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <PetalErrorCard
        error={error}
        onRetry={onRetry}
        onAskFix={onAskFix}
        onDismiss={onDismissError}
        onBuyCredits={onBuyCredits}
      />
    );
  }

  const fileCount = filesWritten ?? writtenPaths?.length ?? 0;
  const costLabel =
    typeof creditsCharged === "number"
      ? creditsCharged === 0
        ? "Free"
        : creditsCharged === 1
          ? "1 credit"
          : `${creditsCharged.toFixed(creditsCharged < 10 ? 1 : 0)} credits`
      : null;

  // Completion collapses to one scannable line: Done · 7 files · 1m 12s · 2 credits
  const doneBits = [
    fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : null,
    elapsed > 0 ? formatDuration(elapsed) : null,
    costLabel,
  ].filter(Boolean) as string[];

  const headline = isComplete
    ? `Done${doneBits.length ? ` · ${doneBits.join(" · ")}` : " — your app is live"}`
    : (currentPhase?.label ?? "Working…");

  // Verb + filename chip for the live step, the way a teammate would say it.
  const activeFile =
    isActive && currentPhase?.id === "writing" && latestPath ? latestPath.split("/").pop() : null;

  const CurrentIcon = currentPhase ? PHASE_ICONS[currentPhase.id] : Sparkles;

  // Six-segment phase rail so progress is visible without opening anything.
  const phaseIndex = phases.findIndex((p) => p.id === currentPhase?.id);

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-sm backdrop-blur-sm transition-all">
        <div className="flex gap-px" aria-hidden>
          {phases.map((p, i) => (
            <span
              key={p.id}
              className={`h-1 flex-1 transition-colors duration-500 ${
                p.status === "failed"
                  ? "bg-destructive"
                  : p.status === "done" || isComplete
                    ? "bg-primary/70"
                    : i === phaseIndex
                      ? "bg-primary/70 animate-pulse"
                      : "bg-border/60"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              isComplete ? "bg-emerald-500/15 text-emerald-600" : "bg-primary/10 text-primary"
            }`}
            aria-hidden
          >
            {isActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isComplete ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <CurrentIcon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                key={`label-${headline}`}
                className={`truncate text-[14.5px] font-bold tracking-[-0.01em] animate-fade-in motion-reduce:animate-none ${
                  isActive ? "petal-shimmer" : "text-foreground"
                }`}
              >
                {headline}
              </span>
              {activeFile && (
                <code className="shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold">
                  {activeFile}
                </code>
              )}
              {elapsed > 0 && !isComplete && (
                <span className="shrink-0 font-mono text-[10.5px] font-semibold text-muted-foreground/70 tabular-nums">
                  {elapsed}s
                </span>
              )}
            </div>
            {subCaption && (
              <div
                key={`cap-${subCaption}`}
                className="mt-0.5 line-clamp-2 text-[12px] font-medium text-muted-foreground animate-fade-in motion-reduce:animate-none"
              >
                {subCaption}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border/60 p-2">
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-[13px] font-bold transition hover:bg-muted"
          >
            <ListTree className="h-3.5 w-3.5" aria-hidden />
            Details
          </button>
          <button
            type="button"
            onClick={onOpenPreview}
            disabled={!onOpenPreview}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-[13px] font-bold transition hover:bg-muted disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Preview
          </button>
        </div>
      </div>

      <BuildDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        phases={phases}
        elapsed={elapsed}
        isActive={isActive}
        thinkingLog={thinkingLog}
        timelineEvents={timelineEvents}
        designCaption={designCaption}
        latestPath={latestPath}
        writtenPaths={writtenPaths}
        fileTimestamps={fileTimestamps}
        completedPaths={completedPaths}
        finalFileLines={finalFileLines}
        fileChanges={fileChanges}
        creditsCharged={creditsCharged}
        onReviewChanges={onReviewChanges}
      />

    </>
  );
}
