/**
 * EnableBackendSuggestionChip — inline CTA shown under an assistant message
 * when Petal detects the user is asking for something that needs persistence
 * (auth, database, file storage, etc.) AND the project doesn't have a
 * backend connected yet.
 *
 * - Free plan → opens the upgrade nudge instead of the purchase dialog.
 *   (Managed backend is a paid add-on; we never want a Pay Now button to
 *    take a free user to Paystack only to bounce them back.)
 * - Paid plan → opens BuyBackendSlotDialog which kicks off provisioning.
 *
 * Self-dismissable: once clicked or X'd it stays hidden for the session via
 * sessionStorage (per project) so it doesn't pop up on every assistant turn.
 */
import { useState } from "react";
import { Database, X, Sparkles } from "lucide-react";
import { EnableBackendFromCloudDialog } from "@/components/EnableBackendFromCloudDialog";

type Props = {
  projectId: string;
  /** Kept for backwards compat; backend is now Cloud-balance gated, not plan gated. */
  isPaidPlan?: boolean;
  reason?: string;
  /** Optional: open the in-app billing sheet on "See plans". */
  onUpgrade?: () => void;
  onDismiss: () => void;
};

export function EnableBackendSuggestionChip({
  projectId,
  reason,
  onDismiss,
}: Props) {
  const [enableOpen, setEnableOpen] = useState(false);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          Looks like you'll need a backend{reason ? ` to ${reason}` : ""}.
        </span>
        <button
          type="button"
          onClick={() => setEnableOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          <Sparkles className="h-3 w-3" /> Add backend
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

      <EnableBackendFromCloudDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        projectId={projectId}
      />
    </>
  );
}
