/**
 * The warm, story-like activity feed users see while Petal builds their app.
 * Replaces the old "Thinking… / Writing project… / Applying changes…" line.
 *
 * Renders inside the chat thread. Self-contained — no app state, just props.
 * Auto-collapses to a single success line a few seconds after going live.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,

  Wrench,
  X,

  Sparkles,
  Palette,
  FileEdit,
  Wand2,
  Rocket,
  CheckCircle2,
  Loader2,
  Check,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { type Phase, type PhaseId, totalElapsedSeconds } from "@/lib/build-phases";
import { pathToNarration } from "@/lib/path-narration";
import type { FriendlyError } from "@/lib/friendly-errors";
import { PetalErrorCard } from "@/components/PetalErrorCard";


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




// Lovable-style: clean monoline icons per phase instead of emoji.
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
  /** Live caption shown under the "Designing" phase as the AI summary streams. */
  designCaption?: string;
  /** Latest file written, shown next to the file counter. */
  latestPath?: string;
  /** Model-written one-liner for the file currently being written
   *  ("Building the photo upload screen"). Overrides path-derived narration. */
  latestNarration?: string;
  /** Most recent agentic-loop progress string (verifier / fix gap narration).
   *  Used as a fallback sub-caption so the card never sits silent during
   *  the 5-10s pauses between file streaming and the next visible event. */
  latestCycleProgress?: string;
  /** Number of files written so far (during the writing phase). */
  filesWritten?: number;
  /** Ordered list of every file path written so far (deduped). */
  writtenPaths?: string[];
  /** Paths whose stream-time `"content"` string finished — drives per-file ✓. */
  completedPaths?: Set<string>;
  /** After completion, final line counts keyed by path — drives the "X lines" badge. */
  finalFileLines?: Record<string, number>;
  /**
   * Per-file change kind + line delta vs. the pre-run snapshot. Drives the
   * "new / modified / deleted" badge and the +A −B counter on each file row.
   * Empty until the run completes.
   */
  fileChanges?: Record<
    string,
    { kind: "added" | "modified" | "unchanged" | "deleted"; addedLines: number; removedLines: number }
  >;
  /** Seconds we've been waiting on the deploy phase. Drives the escalation
   *  copy ("Almost there", "Taking longer", "Still working") so the user
   *  always sees movement rather than a frozen "Putting your app online…". */
  deployElapsedSec?: number;
  /** Live pipeline timeline — server pushes one entry per recovery / verifier
   *  / autofix / image step. Rendered inside the expanded steps panel. */
  timelineEvents?: TimelineEntry[];
  /** Credits actually charged for this turn (from the SSE result event).
   *  Shown on the collapsed success line so users can see exactly what
   *  this build cost. `0` is shown explicitly (free turns / auto-fix). */
  creditsCharged?: number | null;
  onStop?: () => void;
  onRetry?: () => void;
  onAskFix?: () => void;
  onDismissError?: () => void;
  /** Opens the per-file diff drawer comparing the pre-turn snapshot to the
   *  files Petal just wrote. Shown on the collapsed success line. */
  onReviewChanges?: () => void;
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
  onStop,
  onRetry,
  onAskFix,
  onDismissError,
}: Props) {
  // Auto-collapse 3s after success.
  const [collapsed, setCollapsed] = useState(false);
  
  // While building, the steps list is hidden by default — competitors (Lovable,
  // Bolt, v0) all show a single calm evolving status line. Power users can
  // still expand for the full timeline.
  const [stepsOpen, setStepsOpen] = useState(false);
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

  // The currently-active phase drives the single status line. Falls back to
  // the last completed phase (e.g. right between phases) or the first phase.
  const currentPhase: Phase =
    phases.find((p) => p.status === "active") ??
    [...phases].reverse().find((p) => p.status === "done") ??
    phases[0];

  // Optional sub-caption shown under the status line. Mirrors the per-phase
  // micro-context the old expanded view showed inline.
  let subCaption: string | undefined;
  if (currentPhase?.id === "designing" && designCaption) {
    subCaption = designCaption;
  } else if (currentPhase?.id === "writing") {
    // Talk to the user as we work. Priority:
    //   1. Model-written narration for the current file (warmest, most
    //      specific — Petal's actual voice).
    //   2. Path-derived narration (deterministic fallback).
    //   3. Agentic-loop cycle progress (verifier / fix gap narration).
    //   4. File count (last resort so the line never goes silent).
    const modelLine = latestNarration?.trim();
    const derived = pathToNarration(latestPath);
    if (modelLine) subCaption = modelLine;
    else if (derived) subCaption = derived;
    else if (latestCycleProgress) subCaption = latestCycleProgress;
    else if (filesWritten && filesWritten > 0)
      subCaption = `${filesWritten} file${filesWritten === 1 ? "" : "s"} so far`;
  } else if (currentPhase?.id === "deploying" && typeof deployElapsedSec === "number") {
    // Escalate the deploy copy so the user sees the wait acknowledged. The
    // long tail (>90s) is calmer on purpose — we don't want to alarm anyone
    // about a deploy that's still healthy, just confirm we're paying attention.
    if (deployElapsedSec >= 90) {
      subCaption = "Still working on it — your code is safe, you can keep editing.";
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
  // Final fallback: if the server has a fresh progress line, surface it.
  // This intentionally overrides the canned long-wait reassurance during
  // thinking/polishing so users see what Petal is actually doing now.
  if (isActive && latestCycleProgress && (!subCaption || currentPhase?.id === "thinking" || currentPhase?.id === "polishing")) {
    subCaption = latestCycleProgress;
  }

  // ─── Collapsed success state ─────────────────────────────────────────────
  if (collapsed && isComplete && !error) {
    // Format cost like "0.4 credits" / "1 credit" / "Free" so users see
    // exactly what this turn cost without having to open billing.
    const costLabel =
      typeof creditsCharged === "number"
        ? creditsCharged === 0
          ? "Free"
          : `${creditsCharged === 1 ? "1 credit" : `${creditsCharged.toFixed(creditsCharged < 10 ? 1 : 0)} credits`}`
        : null;
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
          Your app is live · built in {elapsed}s
          {costLabel && (
            <span className="ml-1 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {costLabel}
            </span>
          )}
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
      <PetalErrorCard
        error={error}
        onRetry={onRetry}
        onAskFix={onAskFix}
        onDismiss={onDismissError}
      />
    );
  }

  // ─── Default: single evolving status line (Lovable-style) ───────────────
  // Calm, one-line update that swaps as the phase advances. Tap to expand
  // for the full step-by-step timeline.
  const CurrentIcon = currentPhase ? PHASE_ICONS[currentPhase.id] : Sparkles;
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 transition-all">
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* Active phase shows a spinner; idle/done shows the phase icon. */}
        <span
          key={`icon-${currentPhase?.id ?? "init"}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground animate-fade-in"
          aria-hidden
        >
          {isActive ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CurrentIcon className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[13px] leading-snug">
            <span
              key={`label-${currentPhase?.id ?? "init"}`}
              className={`truncate font-medium animate-fade-in motion-reduce:animate-none ${
                isActive ? "petal-shimmer" : "text-foreground"
              }`}
            >
              {currentPhase?.label ?? "Working…"}
            </span>
            {elapsed > 0 && (
              <span className="shrink-0 font-mono text-[10.5px] font-normal text-muted-foreground/70 tabular-nums">
                {elapsed}s
              </span>
            )}
          </div>
          {subCaption && (
            <div
              key={`cap-${subCaption}`}
              className="mt-0.5 truncate text-[11.5px] text-muted-foreground/80 animate-fade-in motion-reduce:animate-none"
            >
              {subCaption}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">

          <button
            type="button"
            onClick={() => setStepsOpen((s) => !s)}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground/70 transition hover:text-foreground"
            aria-label={stepsOpen ? "Hide steps" : "Show steps"}
          >
            {stepsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {stepsOpen && (
        <div className="border-t border-border/50">
          {(() => {
            // Only surface phases that have actually started (active / done /
            // failed). Showing every pending phase up-front looked like a
            // canned 5-step script ("Reading… Designing… Writing… Adding
            // finishing touches… Putting your app online…") that duplicated
            // the header and ran ahead of reality. The real-time signal is
            // `timelineEvents` plus the active phase row — pending rows
            // only appear once they actually begin.
            // Skip "live" (it's the success state, not a step) AND skip the
            // currently-active phase — it already appears as the header row,
            // so listing it again duplicates the same "Reading your request…"
            // line inside the expanded steps panel.
            const startedPhases = phases.filter(
              (p) => p.id !== "live" && p.status !== "pending" && p.status !== "active",
            );
            const hasContent = startedPhases.length > 0;
            if (!hasContent) {
              return (
                <div className="px-3 py-2 text-[11.5px] text-muted-foreground/70">
                  {latestCycleProgress || "Petal will list each step here as it happens."}
                </div>
              );
            }
            return (
              <>
                {startedPhases.length > 0 && (
                  <ol className="space-y-1.5 px-3 py-2.5">

                    {startedPhases.map((p) => (
                      <PhaseRow
                        key={p.id}
                        phase={p}
                        designCaption={p.id === "designing" ? designCaption : undefined}
                        filesWritten={p.id === "writing" ? filesWritten : undefined}
                        latestPath={p.id === "writing" ? latestPath : undefined}
                        writtenPaths={p.id === "writing" ? writtenPaths : undefined}
                        completedPaths={p.id === "writing" ? completedPaths : undefined}
                        finalFileLines={p.id === "writing" ? finalFileLines : undefined}
                        fileChanges={p.id === "writing" ? fileChanges : undefined}
                      />
                    ))}
                  </ol>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function PhaseRow({
  phase,
  designCaption,
  filesWritten,
  latestPath,
  writtenPaths,
  completedPaths,
  finalFileLines,
  fileChanges,
}: {
  phase: Phase;
  designCaption?: string;
  filesWritten?: number;
  latestPath?: string;
  writtenPaths?: string[];
  completedPaths?: Set<string>;
  finalFileLines?: Record<string, number>;
  fileChanges?: Record<
    string,
    { kind: "added" | "modified" | "unchanged" | "deleted"; addedLines: number; removedLines: number }
  >;
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

  // Decide which file rows to render under the writing phase. We show:
  //   - while active: every path streamed so far, latest highlighted
  //   - when done:    every path that ended up in the result, with line counts
  const showFileList = phase.id === "writing" && (isActive || isDone) && writtenPaths && writtenPaths.length > 0;

  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug">
      <span
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center transition-opacity ${
          isPending ? "text-muted-foreground/40" : isDone ? "text-emerald-500" : isFailed ? "text-destructive" : "text-foreground"
        }`}
        aria-hidden
      >
        {isDone ? (
          <Check className="h-3.5 w-3.5" />
        ) : isFailed ? (
          <X className="h-3.5 w-3.5" />
        ) : isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Circle className="h-2 w-2 fill-current" />
        )}
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
        {showFileList && (
          <ul className="mt-1 space-y-0.5">
            {writtenPaths!.map((p) => {
              const lines = finalFileLines?.[p];
              const isLatest = isActive && p === latestPath;
              const isStreamDone = completedPaths?.has(p) ?? false;
              const change = fileChanges?.[p];
              // Icon priority during the writing phase:
              //   ✕ deleted → ✓ phase finished → ✓ this file finished streaming
              //   → › currently writing this file → · queued
              const rowIcon =
                change?.kind === "deleted"
                  ? "✕"
                  : isDone || isStreamDone
                    ? "✓"
                    : isLatest
                      ? "›"
                      : "·";
              return (
                <li
                  key={p}
                  className={`flex items-center justify-between gap-2 truncate font-mono text-[10px] ${
                    isLatest ? "text-foreground" : "text-muted-foreground"
                  } ${change?.kind === "deleted" ? "line-through opacity-70" : ""}`}
                >
                  <span className="inline-flex min-w-0 items-center gap-1 truncate">
                    <span aria-hidden className="opacity-60">
                      {rowIcon}
                    </span>
                    <span className="truncate">{p}</span>
                    {change && (
                      <ChangeBadge kind={change.kind} />
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                    {change && (change.addedLines > 0 || change.removedLines > 0) && (
                      <span className="text-[10px]">
                        {change.addedLines > 0 && (
                          <span className="font-semibold text-foreground/80">
                            +{change.addedLines}
                          </span>
                        )}
                        {change.addedLines > 0 && change.removedLines > 0 && (
                          <span className="opacity-50"> </span>
                        )}
                        {change.removedLines > 0 && (
                          <span className="font-semibold text-destructive/80">
                            −{change.removedLines}
                          </span>
                        )}
                      </span>
                    )}
                    {typeof lines === "number" && lines > 0 && change?.kind !== "deleted" && (
                      <span className="opacity-70">{lines} lines</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {showReassurance && phase.reassurance && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{phase.reassurance}</div>
        )}
      </div>
    </li>
  );
}

/**
 * Tiny pill that labels each file row as new / modified / deleted /
 * unchanged. Uses semantic tokens so it adapts to dark mode.
 */
function ChangeBadge({ kind }: { kind: "added" | "modified" | "unchanged" | "deleted" }) {
  if (kind === "unchanged") return null;
  const label =
    kind === "added" ? "new" : kind === "deleted" ? "deleted" : "modified";
  const tone =
    kind === "added"
      ? "bg-mint/40 text-foreground/80"
      : kind === "deleted"
        ? "bg-destructive/15 text-destructive"
        : "bg-butter/60 text-foreground/80";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}



