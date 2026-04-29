/**
 * RuntimeTopupModal — pick a preset Naira pack OR type a custom amount,
 * then redirect to Paystack hosted checkout. After Paystack redirects back,
 * the wallet is credited via the webhook + apply_paystack_runtime_topup RPC.
 *
 * Context-aware:
 *   - `minUsdCents` — when set (e.g. opening from "Enable backend"), the
 *     modal preselects the cheapest pack that meets the minimum, dims and
 *     disables packs below it, defaults the custom field to the min amount,
 *     and shows a header banner explaining why.
 *   - Free-plan users can't top up. We block the picker and show an
 *     "Upgrade to Pro" CTA instead so we don't send them to Paystack for
 *     a payment they can't actually use.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink, Sparkles, Lock, Info } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchRuntimeTopupPacks,
  initiateRuntimeTopup,
  formatUsdCents,
  type RuntimeTopupPack,
} from "@/lib/runtime-wallet";
import { useWallet } from "@/hooks/use-wallet";
import { BillingSheet } from "@/components/BillingSheet";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
  /**
   * Minimum USD cents the user needs after this top-up (e.g. 1000 to enable
   * a managed backend). When set, the modal preselects the smallest pack
   * that meets it and disables packs below.
   */
  minUsdCents?: number;
  /** Optional reason shown in the header banner (e.g. "to enable your backend"). */
  minReason?: string;
  /** Called when a Free-plan user clicks "Upgrade to Pro". */
  onUpgrade?: () => void;
};

type Mode = "pack" | "custom";

export function RuntimeTopupModal({
  open,
  onOpenChange,
  onSuccess,
  minUsdCents,
  minReason,
  onUpgrade,
}: Props) {
  const { wallet, loading: walletLoading } = useWallet();
  const isFree = wallet?.plan_code === "free";

  const [loading, setLoading] = useState(true);
  const [packs, setPacks] = useState<RuntimeTopupPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pack");
  const [customNaira, setCustomNaira] = useState<string>("2000");
  const [submitting, setSubmitting] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  // Cheapest pack that satisfies minUsdCents (if any)
  const recommendedPackCode = useMemo(() => {
    if (!packs.length) return null;
    if (!minUsdCents) {
      return packs[Math.min(1, packs.length - 1)].code; // middle pack
    }
    const eligible = packs.filter((p) => p.amount_cents >= minUsdCents);
    if (eligible.length) return eligible[0].code; // cheapest that qualifies
    return packs[packs.length - 1].code; // none qualify → biggest pack
  }, [packs, minUsdCents]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchRuntimeTopupPacks()
      .then((p) => {
        if (cancelled) return;
        setPacks(p);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load packs"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Apply smart default selection once packs are loaded / min changes
  useEffect(() => {
    if (!recommendedPackCode) return;
    setSelectedPack(recommendedPackCode);
  }, [recommendedPackCode]);

  // Default custom amount to the minimum when min is set
  useEffect(() => {
    if (!open || !minUsdCents) return;
    // 1 USD ≈ ₦1500 in our pack ladder (₦1500 → $1). Use that ratio as default.
    const naira = Math.ceil((minUsdCents / 100) * 1500);
    setCustomNaira(String(naira));
  }, [open, minUsdCents]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}?topup=success`;
      let result;
      if (mode === "custom") {
        const naira = Number(customNaira);
        if (!Number.isFinite(naira) || naira < 500) {
          throw new Error("Minimum top-up is ₦500");
        }
        if (naira > 1_000_000) {
          throw new Error("Maximum top-up is ₦1,000,000");
        }
        result = await initiateRuntimeTopup({
          customAmountMinor: Math.round(naira * 100),
          currency: "NGN",
          returnUrl,
        });
      } else {
        if (!selectedPack) throw new Error("Pick a pack");
        const pack = packs.find((p) => p.code === selectedPack);
        if (!pack) throw new Error("Pack not found");
        result = await initiateRuntimeTopup({
          packCode: pack.code,
          currency: pack.currency_code,
          returnUrl,
        });
      }
      window.location.href = result.authorizationUrl;
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start top-up");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Free-plan gate ----------
  if (open && !walletLoading && isFree) {
    return (
      <>
        <Dialog open={open && !billingOpen} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Top-ups require Pro
              </DialogTitle>
              <DialogDescription>
                The Cloud + AI balance is a paid feature. Upgrade to Pro to add funds and unlock
                managed backend, custom domains and higher AI limits.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <p className="font-medium text-foreground">You're on the Free plan.</p>
              <p className="mt-1 text-muted-foreground">
                Free includes daily build credits but doesn't support paid top-ups. Once on Pro you
                can add any amount in Naira and use it across Cloud and AI.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Maybe later
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (onUpgrade) {
                    onOpenChange(false);
                    onUpgrade();
                  } else {
                    setBillingOpen(true);
                  }
                }}
                className="inline-flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <BillingSheet
          open={billingOpen}
          onOpenChange={(v) => {
            setBillingOpen(v);
            if (!v) onOpenChange(false);
          }}
        />
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Top up Cloud + AI balance</DialogTitle>
          <DialogDescription>
            Add funds in Naira via Paystack. Top-ups never expire and are only spent after your
            free monthly allowance.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {minUsdCents ? (
              <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-foreground">
                  You need at least{" "}
                  <span className="font-semibold">{formatUsdCents(minUsdCents)}</span>{" "}
                  {minReason ?? "for this action"}. We've picked the smallest pack that covers
                  it.
                </p>
              </div>
            ) : null}

            <div className="flex gap-2 rounded-full bg-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("pack")}
                className={`flex-1 rounded-full px-3 py-1.5 font-medium transition ${
                  mode === "pack" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                Quick packs
              </button>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`flex-1 rounded-full px-3 py-1.5 font-medium transition ${
                  mode === "custom" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                Custom amount
              </button>
            </div>

            {mode === "pack" ? (
              <div className="space-y-2">
                {packs.map((pack) => {
                  const usd = (pack.amount_cents / 100).toFixed(2);
                  const belowMin = !!minUsdCents && pack.amount_cents < minUsdCents;
                  const isSelected = selectedPack === pack.code;
                  const isRecommended =
                    !!minUsdCents && pack.code === recommendedPackCode && !belowMin;
                  return (
                    <button
                      key={pack.code}
                      type="button"
                      disabled={belowMin}
                      onClick={() => !belowMin && setSelectedPack(pack.code)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                        belowMin
                          ? "cursor-not-allowed border-border/60 opacity-50"
                          : isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold">{pack.label}</span>
                          {isRecommended ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Recommended
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {belowMin
                            ? `≈ $${usd} — not enough ${minReason ?? "for this action"}`
                            : `≈ $${usd} runtime credit`}
                        </div>
                      </div>
                      <div
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition ${
                          isSelected && !belowMin
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {isSelected && !belowMin && (
                          <div className="h-2 w-2 rounded-full bg-background" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="custom-amount" className="text-xs">
                  Amount in Naira
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium">₦</span>
                  <Input
                    id="custom-amount"
                    value={customNaira}
                    onChange={(e) => setCustomNaira(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="2000"
                    inputMode="numeric"
                    className="text-base"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Minimum ₦500. Max ₦1,000,000 per top-up.
                  {minUsdCents
                    ? ` You need ≈ ${formatUsdCents(minUsdCents)} ${minReason ?? ""}.`
                    : ""}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || loading}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting…
              </>
            ) : (
              <>
                Continue to Paystack <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
