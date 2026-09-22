/**
 * The compact build card users see in the chat thread while (and after)
 * Kimble builds their app.
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
  ChevronDown,
  Clock,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { type Phase, type PhaseId, totalElapsedSeconds } from "@/lib/build-phases";
import { buildTrace, formatDuration, type ThoughtTick } from "@/lib/build-trace";
import { latestActivityLine } from "@/lib/activity-language";
import { BuildTimeline } from "@/components/BuildTimeline";

import { pathToNarration } from "@/lib/path-narration";
import type { FriendlyError } from "@/lib/friendly-errors";
import { PetalErrorCard } from "@/components/PetalErrorCard";
import { BuildDetailsSheet, type FileChange } from "@/components/BuildDetailsSheet";
import { BuildResultCard } from "@/components/BuildResultCard";

import { ELAPSED_VISIBLE_AFTER_SEC, formatElapsed } from "@/hooks/use-build-status-label";

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
    | "image_resolve"
    | "prd_contract"
    | "agent_tool";
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
  /** Plan-first — the model's ordered checklist for this turn. */
  buildSteps?: string[];
  /** 0-based index of the step currently being worked on (-1 = none yet). */
  activeStepIndex?: number;
  /** 0-based indexes of finished steps. */
  doneStepIndexes?: number[];
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
  /** What the build service reported it is doing right now, in plain words. */
  deployProgressLabel?: string | null;
  /** Live pipeline timeline pushed by the server. */
  timelineEvents?: TimelineEntry[];
  /** Credits actually charged for this turn. */
  creditsCharged?: number | null;
  /** Running credit estimate streamed mid-turn, before settlement. */
  creditsEstimate?: number | null;
  onStop?: () => void;
  onRetry?: () => void;
  onAskFix?: () => void;
  onDismissError?: () => void;
  onBuyCredits?: () => void;
  /** Opens the per-file diff drawer. */
  onReviewChanges?: () => void;
  /** Jumps the workspace to the live preview. */
  onOpenPreview?: () => void;
  /** Opens the publish panel from the finished-result card. */
  onPublish?: () => void;
  /** Focuses the composer from the finished-result card. */
  onKeepBuilding?: () => void;
  /** One short line describing what this turn changed. */
  resultSummary?: string | null;
  /** Follow-up ideas offered under "Keep building". */
  suggestions?: string[];
  onSuggest?: (prompt: string) => void;
  /** False when the preview is already on screen. */
  showPreviewAction?: boolean;
};

export function BuildActivityCard({
  phases,
  buildSteps,
  activeStepIndex = -1,
  doneStepIndexes,
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
  deployProgressLabel,
  timelineEvents,
  creditsCharged,
  creditsEstimate,
  onRetry,
  onAskFix,
  onDismissError,
  onBuyCredits,
  onReviewChanges,
  onOpenPreview,
  onPublish,
  onKeepBuilding,
  resultSummary,
  suggestions,
  onSuggest,
  showPreviewAction = true,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Tick once a second while active so the elapsed counter updates in real
  // time. `tick` is a memo dependency on purpose — without it the elapsed
  // value froze at whatever it was when `phases` last changed.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isActive]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elapsed = useMemo(() => totalElapsedSeconds(phases), [phases, tick, isActive]);

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

  // Per-step clock. The plan is stated up front, then each step is worked one
  // at a time — so every step carries its own working time, and the header
  // carries the overall running time. Nothing runs "side by side".
  const [stepClock, setStepClock] = useState<Record<number, { start: number; end?: number }>>({});
  useEffect(() => {
    setStepClock((prev) => {
      const next = { ...prev };
      let changed = false;
      if (activeStepIndex >= 0 && next[activeStepIndex] == null) {
        next[activeStepIndex] = { start: Date.now() };
        changed = true;
      }
      for (const i of doneStepIndexes ?? []) {
        const entry = next[i];
        if (entry && entry.end == null) {
          next[i] = { ...entry, end: Date.now() };
          changed = true;
        } else if (!entry) {
          next[i] = { start: Date.now(), end: Date.now() };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeStepIndex, doneStepIndexes]);
  useEffect(() => {
    if (!isActive && !isComplete) setStepClock({});
  }, [isActive, isComplete]);

  const stepDuration = (i: number): string | null => {
    const entry = stepClock[i];
    if (!entry) return null;
    const secs = Math.round(((entry.end ?? Date.now()) - entry.start) / 1000);
    if (secs < 1) return null;
    return secs < 60 ? `${secs}s` : formatElapsed(secs);
  };

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


  // The same chronological trace the Details sheet renders — built here so the
  // card can tail it live instead of showing a separate, thinner feed.
  const trace = useMemo(
    () =>
      buildTrace({
        phases,
        thoughts: thinkingLog,
        writtenPaths,
        fileTimestamps,
        completedPaths,
        fileChanges,
        timelineEvents,
      }),
    [phases, thinkingLog, writtenPaths, fileTimestamps, completedPaths, fileChanges, timelineEvents],
  );

  // Credits: the settled number once it exists, otherwise the running estimate
  // the server streams as soon as token usage is known.
  const creditsShown =
    typeof creditsCharged === "number"
      ? creditsCharged
      : typeof creditsEstimate === "number"
        ? creditsEstimate
        : null;
  const liveCreditLabel =
    creditsShown != null && creditsShown > 0 ? `${creditsShown.toFixed(2)} credits used` : null;

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
  } else if (currentPhase?.id === "deploying" && deployProgressLabel) {
    // Live word from the build service always beats a generic reassurance.
    subCaption = deployProgressLabel;
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
  // The phase rail is a rough map of the turn; the pipeline is the ground
  // truth. If Kimble just did something real (made pictures, checked privacy,
  // repaired a file), that always wins the caption — otherwise the card says
  // "Shipping it" while it is plainly still making images.
  if (isActive) {
    const lastEvent = timelineEvents?.[timelineEvents.length - 1];
    const lastFileTs = writtenPaths?.length
      ? Math.max(0, ...writtenPaths.map((p) => fileTimestamps[p] ?? 0))
      : 0;
    if (lastEvent && lastEvent.ts >= lastFileTs) {
      const live = latestActivityLine(timelineEvents);
      if (live) subCaption = live;
    }
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
        ? "Auto-repair"
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

  // M8 — deploy-phase clock, shown only past the 30s threshold defined once in
  // the status hook so every surface agrees on when "slow" starts.
  const deployClock =
    isActive &&
    currentPhase?.id === "deploying" &&
    typeof deployElapsedSec === "number" &&
    deployElapsedSec >= ELAPSED_VISIBLE_AFTER_SEC
      ? formatElapsed(deployElapsedSec)
      : null;

  // Six-segment phase rail so progress is visible without opening anything.
  const phaseIndex = phases.findIndex((p) => p.id === currentPhase?.id);

  return (
    <>
      {isComplete ? (
        <BuildResultCard
          credits={creditsCharged}
          summary={resultSummary}
          showPreview={showPreviewAction}
          onPreview={onOpenPreview}
          onPublish={onPublish}
          onKeepBuilding={onKeepBuilding}
          onDetails={() => setDetailsOpen(true)}
          suggestions={suggestions}
          onSuggest={onSuggest}
        />
      ) : (
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[var(--shadow-soft)] backdrop-blur-sm transition-all">
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
              {/* M8 — once the deploy phase passes 30s the clock switches to
                  that phase, so a long publish reads as "still working for
                  0:47" instead of a silent spinner. */}
              {deployClock ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-primary tabular-nums">
                  {deployClock}
                </span>
              ) : (
                elapsed > 0 &&
                !isComplete && (
                  <span className="shrink-0 font-mono text-[10.5px] font-semibold text-muted-foreground/70 tabular-nums">
                    {elapsed < 60 ? `${elapsed}s` : formatElapsed(elapsed)}
                  </span>
                )
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
        {/* Everything verbose — the step list, the thought feed, the file
            trace and the cost breakdown — lives behind "Details". The card
            itself stays one headline and one live line. */}


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
            // Preview only becomes clickable once the turn has actually
            // finished — opening it mid-build shows a half-written app.
            disabled={!onOpenPreview || isActive || (!isComplete && !error)}
            title={isActive ? "Available once Kimble finishes" : undefined}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-[13px] font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-background"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {isActive ? "Building…" : "Preview"}
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
