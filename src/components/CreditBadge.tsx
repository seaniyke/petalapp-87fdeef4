/**
 * Credit balance pill in the site header.
 *
 * Hover for breakdown across daily / monthly / top-up. Click opens the
 * BillingSheet (upgrade plans, top up, or open Stripe billing portal).
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";
import { BillingSheet } from "@/components/BillingSheet";

export function CreditBadge() {
  const { wallet, plan, breakdown, loading } = useWallet();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || !wallet || !plan) return null;

  const tone =
    breakdown.total <= 3
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : breakdown.total <= 10
        ? "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300"
        : "border-border/60 bg-muted/40 text-foreground";

  return (
    <>
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={`${breakdown.total} credits remaining. Open billing.`}
            onClick={() => setSheetOpen(true)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors hover:opacity-90",
              tone,
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="tabular-nums">{breakdown.total}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">credits</span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="end" className="w-64 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">{plan.name} plan</p>
            <span className="text-xs text-muted-foreground">{breakdown.total} total</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Daily free</span>
              <span className="tabular-nums">{breakdown.daily}</span>
            </li>
            {breakdown.monthly > 0 && (
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Monthly</span>
                <span className="tabular-nums">{breakdown.monthly}</span>
              </li>
            )}
            {breakdown.topup > 0 && (
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Top-up</span>
                <span className="tabular-nums">{breakdown.topup}</span>
              </li>
            )}
          </ul>
          <p className="mt-3 border-t border-border/40 pt-3 text-[11px] leading-snug text-muted-foreground">
            Each AI message costs 1 credit. Free daily credits refill every day.
          </p>
          <Button
            size="sm"
            className="mt-3 w-full"
            onClick={() => setSheetOpen(true)}
          >
            {plan.code === "free" ? "Upgrade plan" : "Manage billing"}
          </Button>
        </HoverCardContent>
      </HoverCard>
      <BillingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
