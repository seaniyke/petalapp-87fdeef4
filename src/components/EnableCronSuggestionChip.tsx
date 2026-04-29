/**
 * EnableCronSuggestionChip — backend-first when no Cloud, otherwise pitches
 * a scheduled job (pg_cron + API route).
 */
import { Clock, Sparkles, X } from "lucide-react";

type Props = {
  reason?: string;
  needsBackendFirst?: boolean;
  onOpenCron: () => void;
  onSetupBackend?: () => void;
  onDismiss: () => void;
};

export function EnableCronSuggestionChip({
  reason,
  needsBackendFirst,
  onOpenCron,
  onSetupBackend,
  onDismiss,
}: Props) {
  if (needsBackendFirst) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          To {reason ? `"${reason}"` : "run scheduled work"}, your app needs a home for its data first. One tap.
        </span>
        <button
          type="button"
          onClick={onSetupBackend ?? onOpenCron}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          Set it up
        </button>
        <button
          type="button"
          aria-label="Dismiss suggestion"
          onClick={onDismiss}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        Schedule {reason ? `"${reason}"` : "this job"} — Petal wires a cron entry to a server route.
      </span>
      <button
        type="button"
        onClick={onOpenCron}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
      >
        Schedule
      </button>
      <button
        type="button"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
