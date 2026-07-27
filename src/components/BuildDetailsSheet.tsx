/**
 * Full build trace, opened from the "Details" button on the build card.
 *
 * Two tabs:
 *   • Timeline — every phase, thought, file write and verifier check, in order.
 *   • Changes  — the flat file list with new / modified / deleted badges.
 */
import { useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Clock,
  FileEdit,
  GitCompare,
  ListTree,
  Loader2,
  Lightbulb,
  Wrench,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Phase } from "@/lib/build-phases";
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
  thinkingLog: Array<{ id: number; text: string }>;
  timelineEvents?: TimelineEntry[];
  designCaption?: string;
  latestPath?: string;
  writtenPaths?: string[];
  completedPaths?: Set<string>;
  finalFileLines?: Record<string, number>;
  fileChanges?: Record<string, FileChange>;
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
  completedPaths,
  finalFileLines,
  fileChanges,
  onReviewChanges,
}: Props) {
  const visiblePhases = phases.filter((p) => p.id !== "live" && p.status !== "pending");
  const files = writtenPaths ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-4 text-left">
          <SheetTitle className="font-display text-lg tracking-[-0.02em]">
            Build details
          </SheetTitle>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            {isActive ? `Working — ${formatDuration(elapsed)} so far` : `Worked for ${formatDuration(elapsed)}`}
          </p>
        </SheetHeader>

        <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <TabsList className="grid w-full grid-cols-2 rounded-full">
              <TabsTrigger value="timeline" className="rounded-full text-xs">
                <ListTree className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="changes" className="rounded-full text-xs">
                <GitCompare className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Changes
                {files.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {files.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {visiblePhases.length === 0 && thinkingLog.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nothing here yet — Petal logs every step as it happens.
              </p>
            ) : (
              <ol className="relative space-y-1 border-l border-border/60 pl-4">
                {visiblePhases.map((p) => (
                  <TimelineRow
                    key={p.id}
                    icon={
                      p.status === "done" ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : p.status === "failed" ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )
                    }
                    title={p.status === "done" ? p.doneLabel : p.label}
                    detail={
                      (p.id === "designing" ? designCaption : undefined) ?? p.reassurance
                    }
                  />
                ))}
                {thinkingLog.map((line) => (
                  <TimelineRow
                    key={`t-${line.id}`}
                    icon={<Lightbulb className="h-3 w-3 text-muted-foreground" />}
                    title={line.text}
                  />
                ))}
                {files.map((p) => {
                  const change = fileChanges?.[p];
                  const done = completedPaths?.has(p) ?? change != null;
                  return (
                    <TimelineRow
                      key={`f-${p}`}
                      icon={
                        done ? (
                          <FileEdit className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )
                      }
                      title={
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-muted-foreground">
                            {change?.kind === "added" ? "Created" : change?.kind === "deleted" ? "Removed" : "Edited"}
                          </span>
                          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                            {p.split("/").pop()}
                          </code>
                          {p === latestPath && !done && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">now</span>
                          )}
                        </span>
                      }
                      detail={p}
                    />
                  );
                })}
                {(timelineEvents ?? []).map((ev, i) => (
                  <TimelineRow
                    key={`e-${ev.step}-${ev.ts}-${i}`}
                    icon={
                      ev.outcome === "ok" ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : ev.outcome === "fixed" ? (
                        <Wrench className="h-3 w-3 text-amber-500" />
                      ) : ev.outcome === "failed" ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <Circle className="h-2 w-2 fill-current text-muted-foreground/60" />
                      )
                    }
                    title={ev.message}
                    detail={ev.step.replace(/_/g, " ")}
                  />
                ))}
              </ol>
            )}
          </TabsContent>

          <TabsContent value="changes" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {files.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
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
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
                          {change && change.addedLines > 0 && (
                            <span className="font-semibold text-emerald-600">+{change.addedLines}</span>
                          )}
                          {change && change.removedLines > 0 && (
                            <span className="font-semibold text-destructive/80">−{change.removedLines}</span>
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
                    className="mt-3 w-full rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold transition hover:bg-muted"
                  >
                    Open full diff
                  </button>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function TimelineRow({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative py-1.5">
      <span className="absolute -left-[1.4rem] top-2 grid h-4 w-4 place-items-center rounded-full bg-background">
        {icon}
      </span>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[13px] leading-snug text-foreground/90">{title}</div>
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
        <p className="mt-1 break-all rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10.5px] text-muted-foreground">
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
      className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
