/**
 * The one chronological build trace — thoughts rolled up as "Thought for Ns",
 * files created/edited, tool runs and pipeline checks — rendered as a single
 * rail.
 *
 * It is used in two places on purpose so the user and Petal are always looking
 * at the same story:
 *   • inline on the build card, live, tailing the newest rows as they land;
 *   • in full inside the Details sheet.
 */
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  FileEdit,
  FilePlus2,
  FileX2,
  Lightbulb,
  Loader2,
  Rocket,
  Terminal,
  Wrench,
  X,
} from "lucide-react";

import type { TraceEntry } from "@/lib/build-trace";

export function BuildTimeline({
  trace,
  isActive,
  latestPath,
  designCaption,
  /** Render only the newest N rows (inline live view). */
  tail,
  /** Keep the newest row scrolled into view while work is in flight. */
  autoScroll = false,
  className,
}: {
  trace: TraceEntry[];
  isActive: boolean;
  latestPath?: string;
  designCaption?: string;
  tail?: number;
  autoScroll?: boolean;
  className?: string;
}) {
  const tailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll || !isActive) return;
    tailRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [autoScroll, isActive, trace.length]);

  const rows = typeof tail === "number" ? trace.slice(-tail) : trace;

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-xs font-medium text-muted-foreground">
        Nothing here yet — Petal logs every step as it happens.
      </p>
    );
  }

  return (
    <ol className={`relative space-y-0.5 border-l border-border/60 pl-4 ${className ?? ""}`}>
      {rows.map((entry, i) => (
        <TraceRow
          key={entry.key}
          entry={entry}
          isLast={i === rows.length - 1}
          isActive={isActive}
          latestPath={latestPath}
          designCaption={designCaption}
        />
      ))}
      <div ref={tailRef} />
    </ol>
  );
}

export function TraceRow({
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
    detail =
      designCaption && entry.label.toLowerCase().includes("look") ? designCaption : entry.detail;
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
    const isToolRun = entry.detail === "agent tool";
    icon = isToolRun ? (
      <Terminal className="h-3 w-3 text-muted-foreground" />
    ) : entry.outcome === "ok" ? (
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
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {open && detail && (
        <p
          className={`mt-1 whitespace-pre-line rounded-xl bg-muted/50 px-2 py-1.5 text-[11.5px] font-medium leading-relaxed text-muted-foreground ${
            entry.kind === "thought" ? "" : "break-all font-mono text-[10.5px]"
          }`}
        >
          {detail}
        </p>
      )}
    </li>
  );
}
