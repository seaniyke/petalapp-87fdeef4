/**
 * Full build trace, opened from the "Details" button on the build card.
 *
 * Three tabs:
 *   • Timeline — ONE chronological stream: thoughts (rolled up as
 *     "Thought for Ns"), reads, file edits, verifier checks, deploy.
 *   • Changes  — the flat file list with new / edited / deleted badges.
 *   • Summary  — plain-English recap + counts, so you never have to read
 *     the trace to know what happened.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Clock,
  FileEdit,
  FilePlus2,
  FileX2,
  GitCompare,
  ListTree,
  Loader2,
  Lightbulb,
  Rocket,
  ScrollText,
  Wrench,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Phase } from "@/lib/build-phases";
import {
  buildTrace,
  formatDuration,
  traceStats,
  type ThoughtTick,
  type TraceEntry,
} from "@/lib/build-trace";
import type { TimelineEntry } from "@/components/BuildActivityCard";

export type FileChange = {
  kind: "added" | "modified" | "unchanged" | "deleted";
  addedLines: number;
  removedLines: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phases: Phase[];
  elapsed: number;
  isActive: boolean;
  thinkingLog: ThoughtTick[];
  timelineEvents?: TimelineEntry[];
  designCaption?: string;
  latestPath?: string;
  writtenPaths?: string[];
  fileTimestamps?: Record<string, number>;
  completedPaths?: Set<string>;
  finalFileLines?: Record<string, number>;
  fileChanges?: Record<string, FileChange>;
  creditsCharged?: number | null;
  onReviewChanges?: () => void;
};

export function BuildDetailsSheet({
  open,
  onOpenChange,
  phases,
  elapsed,
  isActive,
  thinkingLog,
  timelineEvents,
  designCaption,
  latestPath,
  writtenPaths,
  fileTimestamps,
  completedPaths,
  finalFileLines,
  fileChanges,
  creditsCharged,
  onReviewChanges,
}: Props) {
  const files = writtenPaths ?? [];

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

  const stats = useMemo(() => traceStats(trace), [trace]);

  // Live tail — keep the newest row in view while Petal is still working.
  const tailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !isActive) return;
    tailRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [open, isActive, trace.length]);

  const currentPhase =
    phases.find((p) => p.status === "active") ??
    [...phases].reverse().find((p) => p.status === "done");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-4 text-left">
          <SheetTitle className="font-display text-lg tracking-[-0.02em]">Build details</SheetTitle>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            {isActive
              ? `Working — ${formatDuration(elapsed)} so far`
              : `Worked for ${formatDuration(elapsed)}`}
          </p>
        </SheetHeader>

        <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <TabsList className="grid w-full grid-cols-3 rounded-full">
              <TabsTrigger value="timeline" className="rounded-full text-xs font-semibold">
                <ListTree className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="changes" className="rounded-full text-xs font-semibold">
                <GitCompare className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Changes
                {files.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {files.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="summary" className="rounded-full text-xs font-semibold">
                <ScrollText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Summary
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Timeline ─────────────────────────────────────────────── */}
          <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {trace.length === 0 ? (
              <p className="py-6 text-center text-xs font-medium text-muted-foreground">
                Nothing here yet — Petal logs every step as it happens.
              </p>
            ) : (
              <ol className="relative space-y-0.5 border-l border-border/60 pl-4">
                {trace.map((entry, i) => (
                  <TraceRow
                    key={entry.key}
                    entry={entry}
                    isLast={i === trace.length - 1}
                    isActive={isActive}
                    latestPath={latestPath}
                    designCaption={designCaption}
                  />
                ))}
                <div ref={tailRef} />
              </ol>
            )}
          </TabsContent>

          {/* ── Changes ──────────────────────────────────────────────── */}
          <TabsContent value="changes" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {files.length === 0 ? (
              <p className="py-6 text-center text-xs font-medium text-muted-foreground">
                No file changes in this turn.
              </p>
            ) : (
              <>
                <ul className="space-y-1">
                  {files.map((p) => {
                    const change = fileChanges?.[p];
                    const lines = finalFileLines?.[p];
                    return (
                      <li
                        key={p}
                        className={`flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2 ${
                          change?.kind === "deleted" ? "opacity-70" : ""
                        }`}
                      >
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span
                            className={`truncate font-mono text-[11px] ${
                              change?.kind === "deleted" ? "line-through" : ""
                            }`}
                          >
                            {p}
                          </span>
                          {change && <ChangeBadge kind={change.kind} />}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-semibold tabular-nums">
                          {change && change.addedLines > 0 && (
                            <span className="text-emerald-600">+{change.addedLines}</span>
                          )}
                          {change && change.removedLines > 0 && (
                            <span className="text-destructive/80">−{change.removedLines}</span>
                          )}
                          {typeof lines === "number" && lines > 0 && change?.kind !== "deleted" && (
                            <span className="text-muted-foreground">{lines}L</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {onReviewChanges && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onReviewChanges();
                    }}
                    className="mt-3 w-full rounded-full border border-border bg-background px-3 py-2 text-xs font-bold transition hover:bg-muted"
                  >
                    Open full diff
                  </button>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Summary ──────────────────────────────────────────────── */}
          <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <p className="text-[13px] font-medium leading-relaxed text-foreground/90">
              {summarySentence({
                isActive,
                phaseLabel: currentPhase?.status === "done" ? currentPhase.doneLabel : currentPhase?.label,
                files: files.length,
                elapsed,
                designCaption,
              })}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <StatTile label="Files touched" value={String(stats.filesTouched)} />
              <StatTile label="Time" value={formatDuration(elapsed)} />
              <StatTile label="Checks passed" value={String(stats.checksPassed)} />
              <StatTile
                label="Credits"
                value={
                  typeof creditsCharged === "number"
                    ? creditsCharged === 0
                      ? "Auto-repair"
                      : creditsCharged.toFixed(creditsCharged < 10 ? 1 : 0)
                    : "—"
                }
              />
            </div>

            {(stats.checksFixed > 0 || stats.checksFailed > 0) && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-muted/40 p-3 text-xs font-medium">
                {stats.checksFixed > 0 && (
                  <p className="flex items-center gap-1.5 text-amber-600">
                    <Wrench className="h-3.5 w-3.5" aria-hidden />
                    Auto-fixed {stats.checksFixed} issue{stats.checksFixed === 1 ? "" : "s"} before
                    shipping.
                  </p>
                )}
                {stats.checksFailed > 0 && (
                  <p className="flex items-center gap-1.5 text-destructive">
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {stats.checksFailed} check{stats.checksFailed === 1 ? "" : "s"} still need a
                    look.
                  </p>
                )}
              </div>
            )}

            {stats.thoughts > 0 && (
              <p className="mt-3 text-xs font-medium text-muted-foreground">
                Petal reasoned in {stats.thoughts} pass{stats.thoughts === 1 ? "" : "es"} — open the
                Timeline tab to read the thinking.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function summarySentence({
  isActive,
  phaseLabel,
  files,
  elapsed,
  designCaption,
}: {
  isActive: boolean;
  phaseLabel?: string;
  files: number;
  elapsed: number;
  designCaption?: string;
}) {
  const fileBit = files > 0 ? `${files} file${files === 1 ? "" : "s"}` : "no files yet";
  if (isActive) {
    return `${phaseLabel ?? "Working"} — ${fileBit} touched so far, ${formatDuration(elapsed)} in.${
      designCaption ? ` ${designCaption}` : ""
    }`;
  }
  return `Petal touched ${fileBit} in ${formatDuration(elapsed)}.${
    designCaption ? ` ${designCaption}` : ""
  }`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <div className="text-lg font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function TraceRow({
  entry,
  isLast,
  isActive,
  latestPath,
  designCaption,
}: {
  entry: TraceEntry;
  isLast: boolean;
  isActive: boolean;
  latestPath?: string;
  designCaption?: string;
}) {
  const [open, setOpen] = useState(false);
  const live = isLast && isActive;

  let icon: React.ReactNode;
  let title: React.ReactNode;
  let detail: string | undefined;

  if (entry.kind === "thought") {
    icon = <Lightbulb className="h-3 w-3 text-muted-foreground" />;
    title = (
      <span className="font-semibold">
        Thought for {entry.seconds}s
        {entry.lines.length > 1 && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            · {entry.lines.length} steps
          </span>
        )}
      </span>
    );
    detail = entry.lines.join("\n");
  } else if (entry.kind === "phase") {
    icon =
      entry.status === "done" ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : entry.status === "failed" ? (
        <X className="h-3 w-3 text-destructive" />
      ) : (
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      );
    title = <span className="font-semibold">{entry.label}</span>;
    detail = designCaption && entry.label.toLowerCase().includes("look") ? designCaption : entry.detail;
  } else if (entry.kind === "file") {
    const FileIcon =
      entry.verb === "Created" ? FilePlus2 : entry.verb === "Removed" ? FileX2 : FileEdit;
    icon = entry.done ? (
      <FileIcon className="h-3 w-3 text-muted-foreground" />
    ) : (
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    );
    title = (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="shrink-0 font-semibold text-muted-foreground">{entry.verb}</span>
        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          {entry.path.split("/").pop()}
        </code>
        {typeof entry.addedLines === "number" && entry.addedLines > 0 && (
          <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-600">
            +{entry.addedLines}
          </span>
        )}
        {typeof entry.removedLines === "number" && entry.removedLines > 0 && (
          <span className="shrink-0 font-mono text-[10px] font-bold text-destructive/80">
            −{entry.removedLines}
          </span>
        )}
        {entry.path === latestPath && !entry.done && (
          <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">now</span>
        )}
      </span>
    );
    detail = entry.path;
  } else {
    icon =
      entry.outcome === "ok" ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : entry.outcome === "fixed" ? (
        <Wrench className="h-3 w-3 text-amber-500" />
      ) : entry.outcome === "failed" ? (
        <X className="h-3 w-3 text-destructive" />
      ) : (
        <Circle className="h-2 w-2 fill-current text-muted-foreground/60" />
      );
    title = <span>{entry.message}</span>;
    detail = entry.detail;
  }

  if (entry.kind === "phase" && entry.label.toLowerCase().includes("deploy")) {
    icon = <Rocket className="h-3 w-3 text-primary" />;
  }

  return (
    <li className="relative py-1.5">
      <span
        className={`absolute -left-[1.4rem] top-2 grid h-4 w-4 place-items-center rounded-full bg-background ${
          live ? "ring-2 ring-primary/30" : ""
        }`}
      >
        {icon}
      </span>
      <div className="flex items-start gap-2">
        <div
          className={`min-w-0 flex-1 text-[13px] font-medium leading-snug ${
            live ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {title}
        </div>
        {detail && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 shrink-0 text-muted-foreground/70 transition hover:text-foreground"
            aria-label={open ? "Hide detail" : "Show detail"}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
      {open && detail && (
        <p
          className={`mt-1 whitespace-pre-line rounded-md bg-muted/50 px-2 py-1.5 text-[11.5px] font-medium leading-relaxed text-muted-foreground ${
            entry.kind === "thought" ? "" : "break-all font-mono text-[10.5px]"
          }`}
        >
          {detail}
        </p>
      )}
    </li>
  );
}

export function ChangeBadge({ kind }: { kind: FileChange["kind"] }) {
  if (kind === "unchanged") return null;
  const label = kind === "added" ? "new" : kind === "deleted" ? "deleted" : "edited";
  const tone =
    kind === "added"
      ? "bg-emerald-500/15 text-emerald-600"
      : kind === "deleted"
        ? "bg-destructive/15 text-destructive"
        : "bg-amber-500/15 text-amber-600";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}
