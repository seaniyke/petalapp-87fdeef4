/**
 * EnableBackendSuggestionChip — inline CTA shown under an assistant message
 * when Petal detects the user is asking for something that needs persistence
 * (auth, database, file storage, etc.) AND the project doesn't have a
 * backend connected yet.
 *
 * Free plan: opens BillingSheet (upgrade required).
 * Paid plan: opens EnableBackendFromCloudDialog.
 */
import { useState } from "react";
import { Database, X, Sparkles } from "lucide-react";
import { EnableBackendFromCloudDialog } from "@/components/EnableBackendFromCloudDialog";
import { BillingSheet } from "@/components/BillingSheet";

type Props = {
  projectId: string;
  isPaidPlan?: boolean;
  reason?: string;
  /** Optional override: if provided, takes precedence over BillingSheet. */
  onUpgrade?: () => void;
  onDismiss: () => void;
};

export function EnableBackendSuggestionChip({
  projectId,
  isPaidPlan,
  reason,
  onUpgrade,
  onDismiss,
}: Props) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  const handleClick = () => {
    if (isPaidPlan) {
      setEnableOpen(true);
    } else if (onUpgrade) {
      onUpgrade();
    } else {
      setBillingOpen(true);
    }
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          {isPaidPlan
            ? <>Looks like you'll need a backend{reason ? ` to ${reason}` : ""}.</>
            : <>A backend{reason ? ` for ${reason}` : ""} is included with paid plans.</>}
        </span>
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          <Sparkles className="h-3 w-3" /> {isPaidPlan ? "Add backend" : "Upgrade"}
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
      <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
    </>
  );
}
