/**
 * RuntimeTopupModal — pick a preset Naira pack OR type a custom amount,
 * then redirect to Paystack hosted checkout. After Paystack redirects back,
 * the wallet is credited via the webhook + apply_paystack_runtime_topup RPC.
 */
import { useEffect, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
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
  type RuntimeTopupPack,
} from "@/lib/runtime-wallet";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
};

type Mode = "pack" | "custom";

export function RuntimeTopupModal({ open, onOpenChange, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [packs, setPacks] = useState<RuntimeTopupPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pack");
  const [customNaira, setCustomNaira] = useState<string>("2000");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchRuntimeTopupPacks()
      .then((p) => {
        if (cancelled) return;
        setPacks(p);
        if (p.length > 0 && !selectedPack) {
          setSelectedPack(p[Math.min(1, p.length - 1)].code); // default to middle
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load packs"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      // Redirect to Paystack
      window.location.href = result.authorizationUrl;
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start top-up");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                  return (
                    <button
                      key={pack.code}
                      type="button"
                      onClick={() => setSelectedPack(pack.code)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                        selectedPack === pack.code
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <div>
                        <div className="text-base font-semibold">{pack.label}</div>
                        <div className="text-xs text-muted-foreground">≈ ${usd} runtime credit</div>
                      </div>
                      <div
                        className={`grid h-5 w-5 place-items-center rounded-full border-2 transition ${
                          selectedPack === pack.code
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {selectedPack === pack.code && (
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
