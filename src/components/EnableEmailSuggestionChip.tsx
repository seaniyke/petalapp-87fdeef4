/**
 * EnableEmailSuggestionChip — inline CTA shown under an assistant message
 * when Petal detects the user is talking about sending emails AND the
 * project doesn't have Petal Email enabled yet.
 */
import { Mail, X } from "lucide-react";

type Props = {
  reason?: string;
  /** Open the project settings sheet scrolled to the Email section. */
  onOpenEmail: () => void;
  onDismiss: () => void;
};

export function EnableEmailSuggestionChip({ reason, onOpenEmail, onDismiss }: Props) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        Send emails{reason ? ` for "${reason}"` : ""} with Petal Email — free 3,000/mo.
      </span>
      <button
        type="button"
        onClick={onOpenEmail}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
      >
        Enable
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
