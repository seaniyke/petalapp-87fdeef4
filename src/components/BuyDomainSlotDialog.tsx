/**
 * BuyDomainSlotDialog — domain search + purchase flow.
 *
 * User types a name, we hit Cloudflare via /api/registrar/search to get
 * availability + prices (already marked up cost+25%), they pick one, choose
 * a currency, and we hand off to Paystack.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Globe, Search, Check, X } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchCurrencies,
  formatMoney,
  type BillingCurrency,
} from "@/lib/billing";
import {
  searchDomains,
  purchaseDomain,
  formatUsdCents,
  type DomainSearchResult,
} from "@/lib/registrar";
import { useWallet } from "@/hooks/use-wallet";
import { BillingSheet } from "@/components/BillingSheet";
import { Sparkles } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
};

export function BuyDomainSlotDialog({ open, onOpenChange, projectId }: Props) {
  const { plan } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";
  const [billingOpen, setBillingOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DomainSearchResult[] | null>(null);
  const [selected, setSelected] = useState<DomainSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [currency, setCurrency] = useState<string>("USD");

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
      setSelected(null);
      setSubmitting(false);
    }
  }, [open]);

  // Load currencies once when dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchCurrencies()
      .then((cs) => {
        if (cancelled) return;
        const supported = cs.filter((c) => c.paystack_supported);
        setCurrencies(supported);
        if (supported.length && !supported.find((c) => c.code === currency)) {
          setCurrency(supported[0].code);
        }
      })
      .catch(() => {
        /* ignore */
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

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setResults(null);
    setSelected(null);
    try {
      const rows = await searchDomains(query);
      setResults(rows);
      // Auto-select the first available result for convenience.
      const firstAvail = rows.find((r) => r.available && r.priceCents != null);
      if (firstAvail) setSelected(firstAvail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  /** Convert USD cents → user-currency minor units for display. */
  function localizedPrice(usdCents: number): string {
    if (!selectedCurrency) return formatUsdCents(usdCents);
    const rate = Number(selectedCurrency.usd_rate ?? 1);
    if (selectedCurrency.code === "USD" || rate <= 0) {
      return formatUsdCents(usdCents);
    }
    const localMinor = Math.round((usdCents / 100) * rate * 100);
    return formatMoney(localMinor, selectedCurrency);
  }

  async function handleBuy() {
    if (!selected || selected.priceCents == null) return;
    setSubmitting(true);
    try {
      const returnUrl = `${window.location.origin}/billing/return`;
      const { authorizationUrl } = await purchaseDomain({
        projectId,
        hostname: selected.hostname,
        currency,
        returnUrl,
      });
      window.location.href = authorizationUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start checkout");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Buy a new domain
          </DialogTitle>
          <DialogDescription>
            Search for an available domain. Pricing is wholesale + 25% — what
            you see is what you pay. Includes WHOIS privacy and auto-renewal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            autoFocus
            placeholder="acme or acme.com"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={searching || submitting}
            className="flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!query.trim() || searching || submitting}
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Search</span>
          </Button>
        </form>

        {searching && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking availability…
          </div>
        )}

        {!searching && results && results.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No results. Try a different name.
          </p>
        )}

        {!searching && results && results.length > 0 && (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {results.map((r) => {
              const isSelected = selected?.hostname === r.hostname;
              const canBuy = r.available && r.priceCents != null;
              return (
                <li key={r.hostname}>
                  <button
                    type="button"
                    onClick={() => canBuy && setSelected(r)}
                    disabled={!canBuy}
                    className={[
                      "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/20",
                      canBuy
                        ? "cursor-pointer hover:bg-muted/40"
                        : "cursor-not-allowed opacity-60",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {canBuy ? (
                        isSelected ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0" />
                        )
                      ) : (
                        <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-mono">{r.hostname}</span>
                    </span>
                    <span
                      className={
                        canBuy
                          ? "shrink-0 text-sm font-medium"
                          : "shrink-0 text-[11px] text-muted-foreground"
                      }
                    >
                      {canBuy
                        ? `${localizedPrice(r.priceCents!)}/yr`
                        : "Taken"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected && selected.priceCents != null && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <Label htmlFor="bds-currency" className="text-xs">
              Pay in
            </Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="bds-currency">
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
              Charged once. Renews automatically each year — you'll be reminded
              before renewal.
            </p>
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
            disabled={
              submitting ||
              !selected ||
              selected.priceCents == null ||
              !selectedCurrency
            }
            className="inline-flex items-center gap-1.5"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            {selected && selected.priceCents != null
              ? `Buy ${selected.hostname} for ${localizedPrice(selected.priceCents)}`
              : "Pick a domain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
