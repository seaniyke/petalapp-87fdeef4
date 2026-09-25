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
import { Check, Loader2, Plus, AlertTriangle, CreditCard, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/use-wallet";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  computeBreakdown,
  convertPrice,
  dailyResetCountdown,
  monthlyResetDays as computeMonthlyResetDays,
  fetchCreditPacks,
  SUBSCRIPTIONS_ENABLED,
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
import petalLogo from "@/assets/kimble-logo.png";
import { CryptoCheckoutPanel } from "@/components/CryptoCheckoutPanel";
import { fetchCreditUsage, formatCredits, type CreditUsage } from "@/lib/credit-usage";
import { fetchProjectUsage, formatUsdCents, type ProjectUsageRow } from "@/lib/runtime-wallet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnTo?: string;
};

export function BillingSheet({ open, onOpenChange, returnTo }: Props) {
  const { user } = useAuth();
  const { wallet, plans, plan, breakdown } = useWallet();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedPackCode, setSelectedPackCode] = useState<string | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);

  const [subStatus, setSubStatus] = useState<{
    hasPaystackSubscription: boolean;
    cancelAtPeriodEnd: boolean;
    nextPaymentDate: string | null;
    status: string | null;
  } | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  /** Credit breakdown + usage stay collapsed; the balance is the headline. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cryptoPlanCode, setCryptoPlanCode] = useState<string | null>(null);
  const [cryptoPackOpen, setCryptoPackOpen] = useState(false);
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

  // Load Paystack subscription status (so we can show Manage / Cancel controls).
  useEffect(() => {
    if (!open || !user) {
      setSubStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/billing/subscription/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          hasPaystackSubscription: boolean;
          cancelAtPeriodEnd: boolean;
          nextPaymentDate: string | null;
          status: string | null;
        };
        if (!cancelled) setSubStatus(json);
      } catch (e) {
        console.warn("[BillingSheet] subscription status failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  async function openManageCard() {
    if (!user) return;
    setBusyKey("sub:manage");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const res = await fetch("/api/billing/subscription/manage-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not open card management");
      }
      const json = (await res.json()) as { link?: string };
      if (!json.link) throw new Error("No link returned");
      window.open(json.link, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open card management");
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelSubscription() {
    if (!user) return;
    setBusyKey("sub:cancel");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const res = await fetch("/api/billing/subscription/cancel", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not cancel");
      }
      toast.success("Subscription cancelled. You keep access until the period ends.");
      setSubStatus((s) => (s ? { ...s, cancelAtPeriodEnd: true } : s));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel subscription");
    } finally {
      setBusyKey(null);
      setConfirmCancelOpen(false);
    }
  }

  const paid = useMemo(() => plans.filter((p) => p.code !== "free"), [plans]);
  const currentPlanCode = wallet?.plan_code ?? "free";
  const activePlanCode = selectedPlanCode ?? paid[0]?.code ?? null;

  // Pay-as-you-go: free-plan user whose purchased credits unlock paid features.
  const payAsYouGo =
    currentPlanCode === "free" && Number(wallet?.topup_credits_remaining ?? 0) > 0;
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
      const returnPath = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
        ? `?returnTo=${encodeURIComponent(returnTo)}`
        : "";
      const returnUrl = `${window.location.origin}/billing/return${returnPath}`;
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

  // Daily / monthly reset countdowns.
  // Phase 4 #23 — these used to read the wallet's `*_reset_at` columns as if
  // they were future timestamps. They are date-only period stamps pointing at
  // the CURRENT period, so the maths always went negative and every user saw
  // "resets soon" / "0 days". The boundaries come from the clock instead.
  const dailyResetText = useMemo(() => dailyResetCountdown(), [wallet?.daily_free_used]);
  const monthlyResetDays = useMemo(
    () => computeMonthlyResetDays(),
    [wallet?.monthly_free_used],
  );

  // Total credits (used for progress bar)
  const totalAvailable = breakdown.total;
  const planMonthlyCap = plan?.monthly_credits ?? 0;
  const dailyCap = plan?.daily_free_credits ?? 0;
  // Free credits are capped per month too (e.g. 5/day, 30/month = 6 days).
  const monthlyFreeRemaining =
    plan?.monthly_free_cap == null
      ? Infinity
      : Math.max(0, plan.monthly_free_cap - Number(wallet?.monthly_free_used ?? 0));

  // Estimate "denominator" for the progress bar — what they could have at the
  // start of the period: monthly grant + daily allowance + any topup left.
  const progressDenominator = Math.max(1, planMonthlyCap + dailyCap + breakdown.topup);
  const progressPct = Math.min(100, Math.round((totalAvailable / progressDenominator) * 100));

  const scrollToPlans = () =>
    plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToTopups = () =>
    topupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-lg font-semibold">Credits</SheetTitle>
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

          {/* 1. Balance — one number, one bar. Everything that explains the
              number sits behind "Details" so this stays a glance, not a
              spreadsheet. */}
          <div className="rounded-2xl bg-muted/40 p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Credits left</h3>
              <span className="text-2xl font-semibold tabular-nums">
                {totalAvailable.toLocaleString()}
              </span>
            </div>
            <Progress value={progressPct} className="mt-3 h-2" />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={scrollToTopups}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Get more
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDetailsOpen((v) => !v)}
              >
                {detailsOpen ? "Hide details" : "Details"}
              </Button>
            </div>

            {detailsOpen && (
              <div className="mt-5 space-y-3">
                <CreditRow
                  label="Daily"
                  sub={
                    !dailyCap
                      ? "Not on this plan"
                      : monthlyFreeRemaining === 0
                        ? `Monthly limit used — back in ${monthlyResetDays ?? 0} ${monthlyResetDays === 1 ? "day" : "days"}`
                        : `Back to ${dailyCap} ${dailyResetText ?? "soon"}${
                            plan?.monthly_free_cap
                              ? ` · ${monthlyFreeRemaining} free left this month`
                              : ""
                          }`
                  }
                  value={breakdown.daily}
                />
                <CreditRow
                  label="Monthly"
                  sub={
                    planMonthlyCap
                      ? `Refills in ${monthlyResetDays ?? 0} ${monthlyResetDays === 1 ? "day" : "days"}`
                      : "Not on this plan"
                  }
                  value={breakdown.monthly}
                />
                <CreditRow
                  label="Extra"
                  sub={breakdown.topup > 0 ? "Never expire" : "Top up to add more"}
                  value={breakdown.topup}
                />
                <UsageCard userId={user?.id ?? null} open={open} />
              </div>
            )}
          </div>

          {/* 2. Plan */}
          <div className="rounded-2xl bg-muted/40 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-coral/30 to-primary/20 p-1.5">
                <img src={petalLogo} alt="Kimble" className="h-full w-full object-contain" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">
                  You're on {plan?.name ?? "Free"} plan
                </h3>
                {currentPlanCode === "free" ? (
                  <p className="text-xs text-muted-foreground">
                    {payAsYouGo ? "Credits keep paid features on." : "Buy credits to unlock everything. They never expire."}
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
                  {plan.daily_free_credits} free credits a day
                  {plan.monthly_free_cap ? ` · ${plan.monthly_free_cap} a month` : ""}
                </PlanFeature>
              ) : null}
              {currentPlanCode === "business" && (
                <PlanFeature>Priority support</PlanFeature>
              )}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              {SUBSCRIPTIONS_ENABLED && (
                <Button size="sm" variant="outline" onClick={scrollToPlans}>
                  {currentPlanCode === "free" ? "See plans" : "Change plan"}
                </Button>
              )}
              {subStatus?.hasPaystackSubscription && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openManageCard}
                  disabled={busyKey === "sub:manage"}
                >
                  {busyKey === "sub:manage" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="mr-1 h-3.5 w-3.5" />
                  )}
                  Manage card
                </Button>
              )}
              {subStatus?.hasPaystackSubscription && !subStatus.cancelAtPeriodEnd && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmCancelOpen(true)}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Cancel subscription
                </Button>
              )}
            </div>
            {subStatus?.hasPaystackSubscription && subStatus.cancelAtPeriodEnd && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Cancelled — access lasts until the period ends.
              </p>
            )}
          </div>

          {/* Currency — quiet, only where it matters: just above buying. */}
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
                    className={`rounded-xl border px-2.5 py-1 text-xs font-medium transition-colors ${
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

          {/* 5. Top-up packs — pay as you go comes first */}
          <section ref={topupRef} className="scroll-mt-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Top up credits</h3>
              <p className="text-xs text-muted-foreground">
                Buy once, never expires. Credits pay for building, hosting, AI, domains and badge removal.
              </p>
            </div>

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

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setCryptoPackOpen((v) => !v)}
                className="text-xs font-semibold text-foreground underline underline-offset-2 hover:text-primary"
              >
                {cryptoPackOpen ? "Hide crypto payment" : "Pay for credits with crypto →"}
              </button>
              {cryptoPackOpen &&
                (() => {
                  const pack = packs.find((x) => x.code === selectedPackCode) ?? packs[0];
                  if (!pack) return null;
                  return (
                    <div className="mt-3">
                      <CryptoCheckoutPanel
                        purpose="pack"
                        itemCode={pack.code}
                        itemLabel={`${pack.credits.toLocaleString()} credits`}
                        usdCents={pack.price_cents}
                      />
                    </div>
                  );
                })()}
            </div>
          </section>

          {SUBSCRIPTIONS_ENABLED && <Separator />}

          {/* 6. Plan picker — one selector, one card */}
          {SUBSCRIPTIONS_ENABLED && (
          <section ref={plansRef} className="scroll-mt-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Or subscribe monthly</h3>
              <p className="text-xs text-muted-foreground">Credits refill every month.</p>
            </div>

            {paid.length > 1 && (
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
                {paid.map((p) => {
                  const active = p.code === activePlanCode;
                  return (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => setSelectedPlanCode(p.code)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        active
                          ? "bg-background text-foreground shadow-[var(--shadow-soft)]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const p = paid.find((x) => x.code === activePlanCode) ?? paid[0];
              if (!p) return null;
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
              return (
                <PlanCard
                  plan={p}
                  priceLabel={
                    conv && activeCurrency
                      ? formatMoney(conv.amountMinor, activeCurrency)
                      : `$${(p.price_cents / 100).toFixed(0)}`
                  }
                  isLocalPrice={conv?.source === "override"}
                  isCurrent={isCurrent && !expired}
                  isRenew={isCurrent && expired}
                  busy={busyKey === `plan:${p.code}`}
                  disabled={!user || busyKey === `plan:${p.code}`}
                  onClick={() => startCheckout("plan", p.code)}
                />
              );
            })()}

            <p className="mt-2 text-[11px] text-muted-foreground">
              Card-based payments auto-renew monthly. You can cancel anytime — access continues until the period ends.
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() =>
                  setCryptoPlanCode((cur) => (cur ? null : (activePlanCode ?? null)))
                }
                className="text-xs font-semibold text-foreground underline underline-offset-2 hover:text-primary"
              >
                {cryptoPlanCode ? "Hide crypto payment" : "Prefer crypto? Pay with USDT, BTC or ETH →"}
              </button>
              {cryptoPlanCode && (
                <div className="mt-3 space-y-3">
                  {(() => {
                    const p = paid.find((x) => x.code === activePlanCode) ?? paid[0];
                    if (!p) return null;
                    return (
                      <CryptoCheckoutPanel
                        purpose="plan"
                        itemCode={p.code}
                        itemLabel={`${p.name} plan`}
                        usdCents={p.price_cents}
                      />
                    );
                  })()}
                  <p className="text-[11px] text-muted-foreground">
                    Crypto plans don't auto-renew — send again when the month is up.
                  </p>
                </div>
              )}
            </div>
          </section>
          )}


        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            Your card will not be charged again. You'll keep your current plan and
            credits until {renewsLabel ?? "the period ends"}, then drop to Free.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busyKey === "sub:cancel"}>
            Keep subscription
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              cancelSubscription();
            }}
            disabled={busyKey === "sub:cancel"}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busyKey === "sub:cancel" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Cancel subscription"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// -------------------- Sub-components --------------------

/** Month-to-date credit usage: builds vs Cloud vs AI, plus per-project spend. */
function UsageCard({ userId, open }: { userId: string | null; open: boolean }) {
  const [usage, setUsage] = useState<CreditUsage | null>(null);
  const [projects, setProjects] = useState<ProjectUsageRow[]>([]);
  const [showProjects, setShowProjects] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    Promise.all([fetchCreditUsage(userId), fetchProjectUsage(userId)])
      .then(([u, p]) => {
        if (cancelled) return;
        setUsage(u);
        setProjects(p.filter((x) => x.spentCents > 0 || x.capCents != null));
      })
      .catch((e: unknown) => console.warn("[BillingSheet] usage fetch failed", e));
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  if (!usage) return null;

  return (
    <div className="rounded-2xl bg-muted/40 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">Used this month</h3>
        <span className="text-base font-semibold tabular-nums">
          {formatCredits(usage.totalCredits)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Builds {formatCredits(usage.buildCredits)}</span>
        <span>Cloud {formatCredits(usage.cloudCredits)}</span>
        <span>AI {formatCredits(usage.aiCredits)}</span>
        {usage.computeCredits > 0 && <span>Compute {formatCredits(usage.computeCredits)}</span>}
      </div>

      {projects.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowProjects((v) => !v)}
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {showProjects ? "Hide projects" : "By project"}
          </button>
          {showProjects && (
            <ul className="mt-2 space-y-1.5">
              {projects.map((p) => (
                <li key={p.projectId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">
                    {p.title}
                    {p.paused && <span className="ml-1 text-amber-600">paused</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCredits(centsToCreditsClient(p.spentCents))}
                    {p.capCents != null && ` / cap ${formatUsdCents(p.capCents)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function centsToCreditsClient(cents: number): number {
  return Math.round((cents / 100 / 0.05) * 100) / 100;
}

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
  isRenew = false,
  busy,
  disabled,
  onClick,
}: {
  plan: Plan;
  priceLabel: string;
  isLocalPrice: boolean;
  isCurrent: boolean;
  isRenew?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const highlight = isCurrent || isRenew;
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background"
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
          {plan.daily_free_credits} free credits a day
          {plan.monthly_free_cap
            ? ` — up to ${Math.floor(plan.monthly_free_cap / Math.max(1, plan.daily_free_credits))} days a month`
            : ""}
        </PlanFeature>

        <PlanFeature>100 bonus credits on first upgrade</PlanFeature>
        <PlanFeature>Backend, database, auth &amp; storage</PlanFeature>
        <PlanFeature>AI models, no API key</PlanFeature>
        <PlanFeature>Custom domains &amp; email</PlanFeature>
        {plan.code === "business" && <PlanFeature>Priority support</PlanFeature>}
      </ul>

      <Button
        size="sm"
        variant={isCurrent ? "secondary" : "default"}
        disabled={disabled || isCurrent}
        className="mt-4 w-full"
        onClick={isCurrent ? undefined : onClick}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isCurrent ? (
          "Current plan"
        ) : isRenew ? (
          `Renew ${plan.name}`
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
  const selected =
    packs.find((p) => p.code === selectedCode) ?? packs[1] ?? packs[0] ?? null;
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

  // Three simple choices, most popular in the middle and pre-selected.
  const choices = packs.slice(0, 3);
  const popularCode = choices[1]?.code ?? choices[0]?.code ?? null;
  const active = selectedCode ?? popularCode;

  return (
    <div className="space-y-3">
      {choices.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {choices.map((pack) => {
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
            const isActive = pack.code === active;
            const isPopular = pack.code === popularCode;
            return (
              <button
                key={pack.code}
                type="button"
                onClick={() => onSelect(pack.code)}
                className={`relative rounded-2xl border p-3 text-center transition ${
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-foreground/30"
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
                    Popular
                  </span>
                )}
                <p className="text-sm font-bold tabular-nums">{priceLabel}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {Number(pack.credits)} credits
                </p>
              </button>
            );
          })}
        </div>
      )}

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
          {selConv?.source === "override" && (
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              · local price
            </p>
          )}
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
