/**
 * BuyBackendSlotDialog — paywall for the Petal-managed Supabase backend add-on.
 *
 * One slot = 30 days. Pricing comes from billing_addons + currency rates,
 * exactly like BuyDomainSlotDialog. On confirm we redirect to Paystack.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Database, ExternalLink } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchCurrencies,
  fetchPriceOverrides,
  convertPrice,
  formatMoney,
  type BillingCurrency,
  type PriceOverride,
} from "@/lib/billing";
import {
  fetchBackendSlotAddon,
  purchaseBackendSlot,
  type BackendAddon,
} from "@/lib/managed-backend";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  /** When true, copy talks about renewal rather than first-time purchase. */
  isRenewal?: boolean;
};

export function BuyBackendSlotDialog({ open, onOpenChange, projectId, isRenewal }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [addon, setAddon] = useState<BackendAddon | null>(null);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [currency, setCurrency] = useState<string>("USD");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchBackendSlotAddon(), fetchCurrencies(), fetchPriceOverrides()])
      .then(([a, curs, ovs]) => {
        if (cancelled) return;
        setAddon(a);
        const supported = curs.filter((c) => c.paystack_supported);
        setCurrencies(supported);
        setOverrides(ovs);
        if (supported.length > 0 && !supported.find((c) => c.code === currency)) {
          setCurrency(supported[0].code);
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load pricing"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCurrency = useMemo(
    () => currencies.find((c) => c.code === currency) ?? null,
    [currencies, currency],
  );

  const priceLabel = useMemo(() => {
    if (!addon || !selectedCurrency) return null;
    const { amountMinor } = convertPrice({
      itemKind: "addon",
      itemCode: addon.code,
      usdCents: addon.price_cents,
      currency: selectedCurrency.code,
      currencies,
      overrides,
    });
    return formatMoney(amountMinor, selectedCurrency);
  }, [addon, selectedCurrency, currencies, overrides]);

  const days = addon?.duration_days ?? 30;

  async function handleBuy() {
    if (!addon) return;
    setSubmitting(true);
    try {
      const returnUrl = `${window.location.origin}/billing/return`;
      const { authorizationUrl } = await purchaseBackendSlot({
        projectId,
        currency,
        returnUrl,
      });
      window.location.href = authorizationUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {isRenewal ? "Renew managed backend" : "Auto-provision a backend"}
          </DialogTitle>
          <DialogDescription>
            {isRenewal
              ? `Adds another ${days} days to your managed Supabase backend. We'll resume the project automatically if it was paused.`
              : `Petal will create a Supabase project for you, wire it into your generated app, and keep it running for ${days} days. Renew anytime to keep it active.`}
          </DialogDescription>
        </DialogHeader>

        {loading || !addon ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{addon.name}</p>
                  {addon.description && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {addon.description}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tracking-tight">
                    {priceLabel ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    for {days} days
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bbs-currency" className="text-xs">
                Pay in
              </Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="bbs-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name} ({c.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Base price is ${(addon.price_cents / 100).toFixed(2)} USD. Local prices use today's rate.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleBuy}
            disabled={submitting || loading || !addon || !selectedCurrency}
            className="inline-flex items-center gap-1.5"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            Pay {priceLabel ?? ""} with Paystack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
