/**
 * EnableEmailSuggestionChip — inline CTA shown under an assistant message
 * when Petal detects the user is talking about sending emails.
 *
 * Three modes:
 *  - free plan          → upgrade prompt (email is paid-only)
 *  - needsBackendFirst  → friendly nudge to set up backend first
 *  - default            → "Enable email"
 */
import { useState } from "react";
import { Mail, Sparkles, X } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { BillingSheet } from "@/components/BillingSheet";

type Props = {
  reason?: string;
  /** True when the project doesn't have a managed backend yet. */
  needsBackendFirst?: boolean;
  /** Open the project settings sheet scrolled to the Email section. */
  onOpenEmail: () => void;
  /** Open the backend setup flow (used in needsBackendFirst mode). */
  onSetupBackend?: () => void;
  onDismiss: () => void;
};

export function EnableEmailSuggestionChip({
  reason,
  needsBackendFirst,
  onOpenEmail,
  onSetupBackend,
  onDismiss,
}: Props) {
  const { plan } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";
  const [billingOpen, setBillingOpen] = useState(false);

  if (!isPaidPlan) {
    return (
      <>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
            Sending email{reason ? ` for "${reason}"` : ""} is included with paid plans.
          </span>
          <button
            type="button"
            onClick={() => setBillingOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            <Sparkles className="h-3 w-3" /> Upgrade
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
        <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
      </>
    );
  }

  if (needsBackendFirst) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          To send emails{reason ? ` for "${reason}"` : ""}, your app needs a
          home for its data first. Takes one tap — Petal handles the rest.
        </span>
        <button
          type="button"
          onClick={onSetupBackend ?? onOpenEmail}
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
