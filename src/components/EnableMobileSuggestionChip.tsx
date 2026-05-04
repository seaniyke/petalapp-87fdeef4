/**
 * EnableMobileSuggestionChip — inline CTA shown under an assistant message
 * when Petal detects the user wants a real mobile app (App Store / Play
 * Store presence, push notifications, "install on my phone", etc).
 *
 * Two modes:
 *  - free plan → upgrade prompt (mobile is paid-only, same as backend/email/domain)
 *  - paid plan → "Set up mobile app" opens the MobileAppPanel via project settings
 *
 * Memory rule: mobile is paid-plan gated, never a $10 top-up modal. Free
 * users see Upgrade, never a wallet prompt.
 */
import { useState } from "react";
import { Smartphone, Sparkles, X } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { BillingSheet } from "@/components/BillingSheet";

type Props = {
  reason?: string;
  /** Open the project settings sheet scrolled to the Mobile section. */
  onOpenMobile: () => void;
  onDismiss: () => void;
};

export function EnableMobileSuggestionChip({ reason, onOpenMobile, onDismiss }: Props) {
  const { plan } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";
  const [billingOpen, setBillingOpen] = useState(false);

  if (!isPaidPlan) {
    return (
      <>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
            Shipping a real mobile app{reason ? ` (${reason})` : ""} — App Store, Play Store, push — is included with paid plans.
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

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        Wrap this as a native app{reason ? ` (${reason})` : ""} — Petal handles iOS + Android builds in the cloud.
      </span>
      <button
        type="button"
        onClick={onOpenMobile}
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
