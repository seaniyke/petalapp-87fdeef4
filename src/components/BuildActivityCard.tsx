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
  RefreshCcw,
  Wrench,
  X,
  Square,
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
import type { FriendlyError } from "@/lib/friendly-errors";

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
  completedPaths,
  finalFileLines,
  fileChanges,
  deployElapsedSec,
  onStop,
  onRetry,
  onAskFix,
  onDismissError,
}: Props) {
  // Auto-collapse 3s after success.
  const [collapsed, setCollapsed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
    if (latestPath) subCaption = latestPath;
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

  // ─── Default: single evolving status line (Lovable-style) ───────────────
  // Calm, one-line update that swaps as the phase advances. Tap to expand
  // for the full step-by-step timeline.
  return (
    <div className="mr-6 overflow-hidden transition-all">
      <div className="flex items-center gap-2 py-1">
        {/* Emoji crossfades when the phase changes. The `key` triggers a
            remount so the `animate-fade-in` keyframe replays each time. */}
        <span
          key={`emoji-${currentPhase?.id ?? "init"}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[13px] animate-fade-in"
          aria-hidden
        >
          {currentPhase?.emoji ?? "🌸"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[13px] leading-snug">
            {/* Phase label crossfades on change via key-based remount. While
                active it shimmers — no spinner, no badge, just a calm sheen
                across the text so the user knows it's running. */}
            <span
              key={`label-${currentPhase?.id ?? "init"}`}
              className={`truncate font-medium animate-fade-in motion-reduce:animate-none ${
                isActive ? "petal-shimmer" : "text-foreground"
              }`}
            >
              {currentPhase?.label ?? "Working…"}
            </span>
            {elapsed > 0 && (
              <span className="shrink-0 font-mono text-[10.5px] font-normal text-muted-foreground/80 tabular-nums">
                {elapsed}s
              </span>
            )}
          </div>
          {/* Sub-caption fades whenever its text changes (e.g. new file path
              while writing). Using the caption itself as the key gives a
              fresh fade per-message without extra state. */}
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
          {isActive && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Square className="h-2.5 w-2.5 fill-current" /> Stop
            </button>
          )}
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
        <ol className="mt-1 space-y-1 border-l border-border/60 pl-3">
          {phases.map((p) => (
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
