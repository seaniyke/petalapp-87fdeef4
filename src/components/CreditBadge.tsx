/**
 * Credit balance in the site header.
 *
 * Quiet by default — just a number. It only speaks up when credits are
 * actually low, and then it offers one tap to get more.
 */
import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";
import { BillingSheet } from "@/components/BillingSheet";
import { formatCredits } from "@/lib/format-credits";

export function CreditBadge() {
  const { wallet, plan, breakdown, loading } = useWallet();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || !wallet || !plan) return null;

  const low = breakdown.total <= 10;
  const label = formatCredits(breakdown.total);

  return (
    <>
      <button
        type="button"
        aria-label={`${label} credits left. Open credits and plan.`}
        onClick={() => setSheetOpen(true)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:opacity-90",
          low
            ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
            : "border-border/60 bg-muted/40 text-foreground",
        )}
      >
        <span className="tabular-nums">{label}</span>
        {low ? (
          <span className="text-xs font-semibold">left · Get more</span>
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:inline">credits</span>
        )}
      </button>
      <BillingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
