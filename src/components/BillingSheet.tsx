/**
 * Billing sheet — Lovable-inspired layout.
 *
 * Sections (top → bottom):
 *  1. Optional "expires soon" warning banner (red/amber, prominent)
 *  2. "You're on X plan" status card with feature checklist + Manage / Top up actions
 *  3. "Credits remaining" card with progress bar + Daily / Monthly / Extra breakdown
 *  4. Currency picker
 *  5. Plan picker (Pro / Business cards) — each shows price + credits + features + Upgrade CTA
 *  6. Top-up packs (dropdown + dynamic "Top up $X" button)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Sparkles, AlertTriangle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/hooks/use-wallet";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  computeBreakdown,
  convertPrice,
  fetchCreditPacks,
  fetchCurrencies,
  fetchPriceOverrides,
  formatMoney,
  SUPPORTED_CURRENCIES,
  type BillingCurrency,
  type CreditPack,
  type Plan,
  type PriceOverride,
} from "@/lib/billing";
import { toast } from "sonner";
import petalLogo from "@/assets/petal-logo.png";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BillingSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { wallet, plans, plan, breakdown } = useWallet();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedPackCode, setSelectedPackCode] = useState<string | null>(null);
  const topupRef = useRef<HTMLDivElement | null>(null);
  const plansRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([fetchCreditPacks(), fetchCurrencies(), fetchPriceOverrides()])
      .then(([p, c, o]) => {
        const sorted = [...p].sort((a, b) => a.price_cents - b.price_cents);
        setPacks(sorted);
        setCurrencies(c);
        setOverrides(o);
        const std = sorted.find((x) => x.price_cents === 1000) ?? sorted[0];
        if (std) setSelectedPackCode((cur) => cur ?? std.code);
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

  // -- Derived values for the new cards --

  const renewsLabel = wallet?.current_period_end
    ? new Date(wallet.current_period_end).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const periodEndMs = wallet?.current_period_end
    ? new Date(wallet.current_period_end).getTime()
    : null;
  const daysUntilExpiry =
    periodEndMs != null ? Math.ceil((periodEndMs - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  const expired = daysUntilExpiry != null && daysUntilExpiry <= 0;
  const expiresSoon = daysUntilExpiry != null && daysUntilExpiry > 0 && daysUntilExpiry <= 5;
  const showWarningBanner = currentPlanCode !== "free" && (expired || expiresSoon);

  // Daily reset countdown
  const dailyResetText = useMemo(() => {
    if (!wallet?.daily_free_reset_at) return null;
    const ms = new Date(wallet.daily_free_reset_at).getTime() - Date.now();
    if (ms <= 0) return "soon";
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${minutes}m`;
  }, [wallet?.daily_free_reset_at]);

  // Monthly reset countdown (in days)
  const monthlyResetDays = useMemo(() => {
    if (!wallet?.monthly_free_reset_at) return null;
    const ms = new Date(wallet.monthly_free_reset_at).getTime() - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }, [wallet?.monthly_free_reset_at]);

  // Total credits (used for progress bar)
  const totalAvailable = breakdown.total;
  const planMonthlyCap = plan?.monthly_credits ?? 0;
  const dailyCap = plan?.daily_free_credits ?? 0;
  // Estimate "denominator" for the progress bar — what they could have at the
  // start of the period: monthly grant + daily allowance + any topup left.
  const progressDenominator = Math.max(1, planMonthlyCap + dailyCap + breakdown.topup);
  const progressPct = Math.min(100, Math.round((totalAvailable / progressDenominator) * 100));

  const scrollToPlans = () =>
    plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToTopups = () =>
    topupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-4 w-4" />
            Plans &amp; credits
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {/* 1. Warning banner */}
          {showWarningBanner && (
            <div
              className={`rounded-2xl p-4 ${
                expired
                  ? "bg-destructive text-destructive-foreground"
                  : "border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1 text-sm">
                  {expired ? (
                    <>
                      Your {plan?.name ?? "plan"} expired. Renew to keep your monthly
                      credits.
                    </>
                  ) : (
                    <>
                      Your {plan?.name ?? "plan"} expires in {daysUntilExpiry}{" "}
                      {daysUntilExpiry === 1 ? "day" : "days"}
                      {renewsLabel ? ` (${renewsLabel})` : ""}. Renew to avoid losing
                      monthly credits.
                    </>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={expired ? "secondary" : "outline"}
                className={`mt-3 w-full ${expired ? "" : "bg-background"}`}
                onClick={scrollToPlans}
              >
                Renew now
              </Button>
            </div>
          )}

          {/* 2. Current plan card */}
          <div className="rounded-2xl bg-muted/40 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-coral/30 to-primary/20 p-1.5">
                <img src={petalLogo} alt="Petal" className="h-full w-full object-contain" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">
                  You're on {plan?.name ?? "Free"} plan
                </h3>
                {currentPlanCode === "free" ? (
                  <p className="text-xs text-muted-foreground">
                    Upgrade for monthly credits and on-demand top-ups.
                  </p>
                ) : renewsLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {expired ? "Expired " : "Renews "}
                    {renewsLabel}
                  </p>
                ) : null}
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-sm">
              {plan?.monthly_credits ? (
                <PlanFeature>
                  {plan.monthly_credits.toLocaleString()} monthly credits
                </PlanFeature>
              ) : null}
              {plan?.daily_free_credits ? (
                <PlanFeature>
                  {plan.daily_free_credits} daily credits
                  {plan.monthly_free_cap ? ` (up to ${plan.monthly_free_cap}/month)` : ""}
                </PlanFeature>
              ) : null}
              {currentPlanCode !== "free" && (
                <PlanFeature>On-demand credit top-ups</PlanFeature>
              )}
              {currentPlanCode === "business" && (
                <PlanFeature>Priority support</PlanFeature>
              )}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={scrollToPlans}>
                {currentPlanCode === "free" ? "See plans" : "Manage"}
              </Button>
              {currentPlanCode !== "free" && (
                <Button size="sm" variant="outline" onClick={scrollToTopups}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Top up credits
                </Button>
              )}
            </div>
          </div>

          {/* 3. Credits remaining */}
          <div className="rounded-2xl bg-muted/40 p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Credits remaining</h3>
              <span className="text-2xl font-semibold tabular-nums">
                {totalAvailable.toLocaleString()}
              </span>
            </div>
            <Progress value={progressPct} className="mt-3 h-2" />

            <div className="mt-5 space-y-3">
              <CreditRow
                label="Daily credits"
                sub={
                  dailyCap
                    ? `Resets to ${dailyCap} credits ${dailyResetText ?? "soon"}`
                    : "Not included on this plan"
                }
                value={breakdown.daily}
              />
              <CreditRow
                label="Monthly credits"
                sub={
                  planMonthlyCap
                    ? `Resets to ${planMonthlyCap.toLocaleString()} in ${
                        monthlyResetDays ?? 0
                      } ${monthlyResetDays === 1 ? "day" : "days"}`
                    : "Not included on this plan"
                }
                value={breakdown.monthly}
              />
              <CreditRow
                label="Extra credits"
                sub={
                  breakdown.topup > 0
                    ? `${breakdown.topup} top-up credits expire in 1 year`
                    : "Top up to add extra credits"
                }
                value={breakdown.topup}
              />
            </div>
          </div>

          {/* 4. Currency picker */}
          <div>
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

          <Separator />

          {/* 5. Plan picker */}
          <section ref={plansRef} className="scroll-mt-4">
            <h3 className="mb-3 text-sm font-semibold">Choose a plan</h3>
            <div className="space-y-3">
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
                  <PlanCard
                    key={p.code}
                    plan={p}
                    priceLabel={
                      conv && activeCurrency
                        ? formatMoney(conv.amountMinor, activeCurrency)
                        : `$${(p.price_cents / 100).toFixed(0)}`
                    }
                    isLocalPrice={conv?.source === "override"}
                    isCurrent={isCurrent}
                    busy={busy}
                    disabled={!user || busy}
                    onClick={() => startCheckout("plan", p.code)}
                  />
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Plans don't auto-renew — pay each month to keep your credits.
            </p>
          </section>

          <Separator />

          {/* 6. Top-up packs */}
          <section ref={topupRef} className="scroll-mt-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Top up credits</h3>
              <p className="text-xs text-muted-foreground">
                One-time credits. Expire 12 months after purchase.
              </p>
            </div>

            {currentPlanCode === "free" ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-medium">
                  Upgrade to buy top-up credits
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Top-up packs are available on Pro and Business plans.
                </p>
              </div>
            ) : (
              <TopupPicker
                packs={packs}
                selectedCode={selectedPackCode}
                onSelect={setSelectedPackCode}
                activeCurrency={activeCurrency}
                currency={currency}
                currencies={currencies}
                overrides={overrides}
                busyKey={busyKey}
                disabled={!user}
                onBuy={(code) => startCheckout("pack", code)}
              />
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// -------------------- Sub-components --------------------

function PlanFeature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{children}</span>
    </li>
  );
}

function CreditRow({
  label,
  sub,
  value,
}: {
  label: string;
  sub: string;
  value: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <span className="text-base font-semibold tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  priceLabel,
  isLocalPrice,
  isCurrent,
  busy,
  disabled,
  onClick,
}: {
  plan: Plan;
  priceLabel: string;
  isLocalPrice: boolean;
  isCurrent: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        isCurrent ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{plan.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.monthly_credits.toLocaleString()} credits / month
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">{priceLabel}</p>
          <p className="text-[11px] text-muted-foreground">
            / 30 days{isLocalPrice && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                · local price
              </span>
            )}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        <PlanFeature>{plan.monthly_credits.toLocaleString()} monthly credits</PlanFeature>
        <PlanFeature>
          {plan.daily_free_credits} daily credits
          {plan.monthly_free_cap ? ` (up to ${plan.monthly_free_cap}/month)` : ""}
        </PlanFeature>
        <PlanFeature>On-demand credit top-ups</PlanFeature>
        {plan.code === "business" && <PlanFeature>Priority support</PlanFeature>}
      </ul>

      <Button
        size="sm"
        variant={isCurrent ? "secondary" : "default"}
        disabled={disabled}
        className="mt-4 w-full"
        onClick={onClick}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isCurrent ? (
          "Renew current plan"
        ) : (
          `Upgrade to ${plan.name}`
        )}
      </Button>
    </div>
  );
}

function TopupPicker({
  packs,
  selectedCode,
  onSelect,
  activeCurrency,
  currency,
  currencies,
  overrides,
  busyKey,
  disabled,
  onBuy,
}: {
  packs: CreditPack[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  activeCurrency: BillingCurrency | null;
  currency: string;
  currencies: BillingCurrency[];
  overrides: PriceOverride[];
  busyKey: string | null;
  disabled: boolean;
  onBuy: (code: string) => void;
}) {
  const selected = packs.find((p) => p.code === selectedCode) ?? packs[0] ?? null;
  const selConv =
    selected && activeCurrency
      ? convertPrice({
          itemKind: "pack",
          itemCode: selected.code,
          usdCents: selected.price_cents,
          currency,
          currencies,
          overrides,
        })
      : null;
  const busy = selected ? busyKey === `pack:${selected.code}` : false;
  const perCredit = selected ? selected.price_cents / 100 / Number(selected.credits) : 0;

  const fmtUsd = (cents: number) =>
    `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

  return (
    <div className="space-y-3">
      <Select
        value={selected?.code ?? undefined}
        onValueChange={onSelect}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a top-up amount" />
        </SelectTrigger>
        <SelectContent>
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
            const priceLabel =
              conv && activeCurrency
                ? formatMoney(conv.amountMinor, activeCurrency)
                : fmtUsd(pack.price_cents);
            return (
              <SelectItem key={pack.code} value={pack.code}>
                <span className="flex w-full items-center justify-between gap-4">
                  <span className="font-medium">{priceLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {Number(pack.credits)} credits
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {selected && (
        <div className="rounded-2xl border border-border/60 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{Number(selected.credits)} credits</p>
            <p className="text-lg font-semibold tabular-nums">
              {selConv && activeCurrency
                ? formatMoney(selConv.amountMinor, activeCurrency)
                : fmtUsd(selected.price_cents)}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            ≈ ${perCredit.toFixed(3)} per credit
            {selConv?.source === "override" && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                · local price
              </span>
            )}
          </p>
          <Button
            size="sm"
            disabled={disabled || busy}
            className="mt-3 w-full"
            onClick={() => onBuy(selected.code)}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Top up ${
                selConv && activeCurrency
                  ? formatMoney(selConv.amountMinor, activeCurrency)
                  : fmtUsd(selected.price_cents)
              }`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// `computeBreakdown` re-export-friendly noop guard (preserves tree-shaking link).
void computeBreakdown;
