/**
 * Credits sheet.
 *
 * Sections (top → bottom):
 * Balance, usage, currency selection, and one-time credit packs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/use-wallet";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  computeBreakdown,
  convertPrice,
  dailyResetCountdown,
  monthlyResetDays as computeMonthlyResetDays,
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
import { CryptoCheckoutPanel } from "@/components/CryptoCheckoutPanel";
import { RecentPurchases } from "@/components/RecentPurchases";
import { fetchCreditUsage, formatCredits, type CreditUsage } from "@/lib/credit-usage";
import { fetchProjectUsage, formatUsdCents, type ProjectUsageRow } from "@/lib/runtime-wallet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnTo?: string;
};

export function BillingSheet({ open, onOpenChange, returnTo }: Props) {
  const { user } = useAuth();
  const { wallet, plan, breakdown } = useWallet();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedPackCode, setSelectedPackCode] = useState<string | null>(null);
  /** Credit breakdown + usage stay collapsed; the balance is the headline. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cryptoPackOpen, setCryptoPackOpen] = useState(false);
  const [customMajor, setCustomMajor] = useState("");
  const topupRef = useRef<HTMLDivElement | null>(null);

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

  const activeCurrency = useMemo(
    () => currencies.find((c) => c.code === currency) ?? null,
    [currencies, currency],
  );

  async function startCheckout(itemCode: string) {
    if (!user) return;
    setBusyKey(`pack:${itemCode}`);
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
        body: JSON.stringify({
          purpose: "pack",
          itemCode,
          currency,
          returnUrl,
          ...(itemCode === CUSTOM
            ? { customAmountMinor: Math.round(Number(customMajor) * 100) }
            : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          msg = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          /* plain text */
        }
        throw new Error(msg || "Could not start checkout");
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
  const dailyCap = plan?.daily_free_credits ?? 0;
  // Free credits are capped per month too (e.g. 5/day, 30/month = 6 days).
  const monthlyFreeRemaining =
    plan?.monthly_free_cap == null
      ? Infinity
      : Math.max(0, plan.monthly_free_cap - Number(wallet?.monthly_free_used ?? 0));

  // Estimate "denominator" for the progress bar — what they could have at the
  // start of the period: monthly grant + daily allowance + any topup left.
  const progressDenominator = Math.max(1, dailyCap + breakdown.topup);
  const progressPct = Math.min(100, Math.round((totalAvailable / progressDenominator) * 100));

  const scrollToTopups = () =>
    topupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-lg font-semibold">Credits</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 p-4">

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
                      ? "No free credits available"
                      : monthlyFreeRemaining === 0
                        ? `Free-credit limit used — back in ${monthlyResetDays ?? 0} ${monthlyResetDays === 1 ? "day" : "days"}`
                        : `Back to ${dailyCap} ${dailyResetText ?? "soon"}${
                            plan?.monthly_free_cap
                              ? ` · ${monthlyFreeRemaining} free credits left`
                              : ""
                          }`
                  }
                  value={breakdown.daily}
                />
                <CreditRow
                  label="Purchased"
                  sub={breakdown.topup > 0 ? "Never expire" : "Top up to add more"}
                  value={breakdown.topup}
                />
                <UsageCard userId={user?.id ?? null} open={open} />
              </div>
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
                Buy once, never expires. No saved card is required. Credits pay for building, hosting, AI, domains and badge removal.
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
              onBuy={startCheckout}
              customMajor={customMajor}
              onCustomMajor={setCustomMajor}
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
                  if (selectedPackCode === CUSTOM) {
                    const rate = currency === "USD" ? 1 : Number(activeCurrency?.usd_rate ?? 0);
                    const usd = rate > 0 ? Math.floor((Number(customMajor) * 100) / rate) : 0;
                    if (usd < MIN_USD_CENTS) {
                      return (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Enter at least $3 above to pay with crypto.
                        </p>
                      );
                    }
                    return (
                      <div className="mt-3">
                        <CryptoCheckoutPanel
                          purpose="pack"
                          itemCode={CUSTOM}
                          itemLabel={`$${(usd / 100).toFixed(2)} of credits`}
                          usdCents={usd}
                          customUsdCents={usd}
                        />
                      </div>
                    );
                  }
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

          <Separator />
          <RecentPurchases open={open} />
        </div>
      </SheetContent>
    </Sheet>
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
        <h3 className="text-base font-semibold">Credit usage</h3>
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

const CUSTOM = "custom";
/** Mirrors the server floor (min_purchase_usd_cents). Server is authoritative. */
const MIN_USD_CENTS = 300;
/** Mirrors credit_retail_usd_cents for the live preview. Server is authoritative. */
const RETAIL_USD_CENTS_PER_CREDIT = 15;

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
  customMajor,
  onCustomMajor,
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
  customMajor: string;
  onCustomMajor: (v: string) => void;
}) {
  const fmtUsd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  const priceOf = (pack: CreditPack) => {
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
    return conv && activeCurrency ? formatMoney(conv.amountMinor, activeCurrency) : fmtUsd(pack.price_cents);
  };

  const isCustom = selectedCode === CUSTOM;
  const selected = isCustom ? null : packs.find((p) => p.code === selectedCode) ?? packs[0] ?? null;
  const rate = currency === "USD" ? 1 : Number(activeCurrency?.usd_rate ?? 0);
  const symbol = activeCurrency?.symbol ?? "$";
  const amount = Number(customMajor);
  const customUsdCents = rate > 0 && amount > 0 ? Math.floor((amount * 100) / rate) : 0;
  const customCredits = Math.floor((customUsdCents / RETAIL_USD_CENTS_PER_CREDIT) * 100) / 100;
  const minLocal = rate > 0 ? Math.ceil((MIN_USD_CENTS / 100) * rate) : 3;
  const belowMin = customUsdCents < MIN_USD_CENTS;
  const busy = isCustom ? busyKey === `pack:${CUSTOM}` : selected ? busyKey === `pack:${selected.code}` : false;

  return (
    <div className="space-y-3">
      <Select value={isCustom ? CUSTOM : selected?.code ?? undefined} onValueChange={onSelect}>
        <SelectTrigger className="h-11 rounded-xl">
          <SelectValue placeholder="Choose credits" />
        </SelectTrigger>
        <SelectContent>
          {packs.map((pack) => (
            <SelectItem key={pack.code} value={pack.code}>
              {Number(pack.credits).toLocaleString()} credits — {priceOf(pack)}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Custom amount</SelectItem>
        </SelectContent>
      </Select>

      {isCustom ? (
        <div className="rounded-2xl border border-border/60 p-4">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="custom-credit-amount">
            Amount ({currency})
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {symbol}
            </span>
            <Input
              id="custom-credit-amount"
              inputMode="decimal"
              type="number"
              min={0}
              step="any"
              value={customMajor}
              onChange={(e) => onCustomMajor(e.target.value)}
              placeholder={String(minLocal)}
              className="h-11 rounded-xl pl-10 tabular-nums"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {amount > 0 && !belowMin
              ? `You get about ${customCredits.toLocaleString()} credits`
              : `Minimum ${symbol}${minLocal.toLocaleString()}${currency === "USD" ? "" : " ($3)"}`}
          </p>
          <Button
            size="sm"
            disabled={disabled || busy || belowMin}
            className="mt-3 w-full"
            onClick={() => onBuy(CUSTOM)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Buy ${symbol}${amount > 0 ? amount.toLocaleString() : 0}`}
          </Button>
        </div>
      ) : (
        selected && (
          <div className="rounded-2xl border border-border/60 p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">{Number(selected.credits).toLocaleString()} credits</p>
              <p className="text-lg font-semibold tabular-nums">{priceOf(selected)}</p>
            </div>
            <Button
              size="sm"
              disabled={disabled || busy}
              className="mt-3 w-full"
              onClick={() => onBuy(selected.code)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Top up ${priceOf(selected)}`}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

// `computeBreakdown` re-export-friendly noop guard (preserves tree-shaking link).
void computeBreakdown;
