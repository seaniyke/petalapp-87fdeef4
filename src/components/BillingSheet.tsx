/**
 * Billing sheet — Paystack hosted checkout, multi-currency.
 *
 * User picks NGN/GHS/KES/ZAR/USD; prices convert via admin rates (with
 * optional per-currency overrides). Buy buttons start a Paystack transaction
 * and redirect to the Paystack hosted page.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useWallet } from "@/hooks/use-wallet";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  convertPrice,
  fetchCreditPacks,
  fetchCurrencies,
  fetchPriceOverrides,
  formatMoney,
  SUPPORTED_CURRENCIES,
  type BillingCurrency,
  type CreditPack,
  type PriceOverride,
} from "@/lib/billing";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BillingSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { wallet, plans, plan } = useWallet();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([fetchCreditPacks(), fetchCurrencies(), fetchPriceOverrides()])
      .then(([p, c, o]) => {
        setPacks(p);
        setCurrencies(c);
        setOverrides(o);
      })
      .catch((e: unknown) => console.warn("[BillingSheet] catalog fetch failed", e));
  }, [open]);

  useEffect(() => {
    if (wallet?.preferred_currency) setCurrency(wallet.preferred_currency);
  }, [wallet?.preferred_currency]);

  const paid = useMemo(() => plans.filter((p) => p.code !== "free"), [plans]);
  const currentPlanCode = wallet?.plan_code ?? "free";
  const activeCurrency = useMemo(
    () => currencies.find((c) => c.code === currency) ?? null,
    [currencies, currency],
  );

  async function startCheckout(purpose: "plan" | "pack", itemCode: string) {
    if (!user) return;
    setBusyKey(`${purpose}:${itemCode}`);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const returnUrl = `${window.location.origin}/billing/return`;
      const res = await fetch("/api/billing/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose, itemCode, currency, returnUrl }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not start checkout");
      }
      const json = (await res.json()) as { authorizationUrl?: string };
      if (!json.authorizationUrl) throw new Error("No checkout URL returned");
      window.location.assign(json.authorizationUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyKey(null);
    }
  }

  const expiresSoon =
    wallet?.current_period_end != null &&
    new Date(wallet.current_period_end).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Plans & credits
          </SheetTitle>
          <SheetDescription>
            Each AI message costs 1 credit. Buy a monthly plan or top up anytime.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Pay in</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_CURRENCIES.map((code) => {
              const c = currencies.find((x) => x.code === code);
              if (!c) return null;
              const isActive = currency === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrency(code)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 hover:bg-muted"
                  }`}
                >
                  {c.symbol} {code}
                </button>
              );
            })}
          </div>
        </div>

        {wallet && wallet.plan_code !== "free" && expiresSoon && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Your {plan?.name ?? "plan"} expires{" "}
            {wallet.current_period_end
              ? new Date(wallet.current_period_end).toLocaleDateString()
              : "soon"}
            . Renew below to keep your monthly credits.
          </div>
        )}

        <div className="mt-6 space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Monthly plans</h3>
              {plan && <Badge variant="secondary">Current: {plan.name}</Badge>}
            </div>
            <div className="grid gap-3">
              {paid.map((p) => {
                const isCurrent = p.code === currentPlanCode;
                const conv = activeCurrency
                  ? convertPrice({
                      itemKind: "plan",
                      itemCode: p.code,
                      usdCents: p.price_cents,
                      currency,
                      currencies,
                      overrides,
                    })
                  : null;
                const busy = busyKey === `plan:${p.code}`;
                return (
                  <div key={p.code} className="rounded-lg border border-border/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.monthly_credits.toLocaleString()} credits / month
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums">
                          {conv && activeCurrency
                            ? formatMoney(conv.amountMinor, activeCurrency)
                            : `$${(p.price_cents / 100).toFixed(0)}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          / 30 days
                          {conv?.source === "override" && (
                            <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                              · local price
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent ? "secondary" : "default"}
                      disabled={!user || busy}
                      className="mt-3 w-full"
                      onClick={() => startCheckout("plan", p.code)}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isCurrent ? (
                        "Renew now"
                      ) : (
                        `Get ${p.name}`
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Plans don't auto-renew — pay each month to keep your credits.
            </p>
          </section>

          <Separator />

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Top-up packs</h3>
              <p className="text-xs text-muted-foreground">
                One-time credits. Expire 12 months after purchase.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {packs.map((pack) => {
                const conv = activeCurrency
                  ? convertPrice({
                      itemKind: "pack",
                      itemCode: pack.code,
                      usdCents: pack.price_cents,
                      currency,
                      currencies,
                      overrides,
                    })
                  : null;
                const busy = busyKey === `pack:${pack.code}`;
                return (
                  <div key={pack.code} className="rounded-lg border border-border/60 p-3">
                    <p className="text-sm font-medium">{pack.credits} credits</p>
                    <p className="mt-1 text-base font-semibold tabular-nums">
                      {conv && activeCurrency
                        ? formatMoney(conv.amountMinor, activeCurrency)
                        : `$${(pack.price_cents / 100).toFixed(0)}`}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!user || busy}
                      className="mt-2 w-full"
                      onClick={() => startCheckout("pack", pack.code)}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buy"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
