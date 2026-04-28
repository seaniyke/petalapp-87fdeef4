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
import { Database, Lock, X, Sparkles } from "lucide-react";
import { BuyBackendSlotDialog } from "@/components/BuyBackendSlotDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  projectId: string;
  isPaidPlan: boolean;
  reason?: string;
  onDismiss: () => void;
};

export function EnableBackendSuggestionChip({
  projectId,
  isPaidPlan,
  reason,
  onDismiss,
}: Props) {
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleClick = () => {
    if (isPaidPlan) setPurchaseOpen(true);
    else setUpgradeOpen(true);
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          Looks like you'll need a backend{reason ? ` to ${reason}` : ""}.
        </span>
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          {isPaidPlan ? (
            <>
              <Sparkles className="h-3 w-3" /> Add backend
            </>
          ) : (
            <>
              <Lock className="h-3 w-3" /> Upgrade to add
            </>
          )}
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

      <BuyBackendSlotDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        projectId={projectId}
      />

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Backend is a paid feature
            </DialogTitle>
            <DialogDescription>
              The Petal-managed backend (auth, database, file storage) is included on
              paid plans. Upgrade to unlock it for this project.
            </DialogDescription>
          </DialogHeader>
          <FreePlanFeatureList />
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setUpgradeOpen(false)}
              className="inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-sm hover:bg-muted"
            >
              Maybe later
            </button>
            <Link
              to="/pricing"
              onClick={() => setUpgradeOpen(false)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-sm transition hover:brightness-110"
            >
              <Sparkles className="h-3.5 w-3.5" /> See plans
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FreePlanFeatureList() {
  return (
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      <li className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        Managed Postgres database with Row Level Security
      </li>
      <li className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        Email + password and OAuth authentication
      </li>
      <li className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        File storage and edge functions, deployed automatically
      </li>
    </ul>
  );
}
