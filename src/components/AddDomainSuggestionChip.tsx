/**
 * AddDomainSuggestionChip — inline CTA shown under an assistant message when
 * Petal detects the user is talking about custom domains AND the project
 * doesn't have one connected yet. Mirrors EnableBackendSuggestionChip.
 */
import { useState } from "react";
import { Globe, X } from "lucide-react";
import { BuyDomainSlotDialog } from "@/components/BuyDomainSlotDialog";

type Props = {
  projectId: string;
  reason?: string;
  /** Open the project settings sheet scrolled to the Domains section. */
  onOpenDomains: () => void;
  onDismiss: () => void;
};

export function AddDomainSuggestionChip({
  projectId,
  reason,
  onOpenDomains,
  onDismiss,
}: Props) {
  const [buyOpen, setBuyOpen] = useState(false);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          Want to use a custom domain{reason ? ` for "${reason}"` : ""}?
        </span>
        <button
          type="button"
          onClick={onOpenDomains}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => setBuyOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          Buy
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

      <BuyDomainSlotDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        projectId={projectId}
      />
    </>
  );
}
