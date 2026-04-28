/**
 * BuilderActionsSheet — iOS-style bottom sheet for the mobile builder.
 *
 * Modeled after Lovable's mobile menu: shows a Credits row with a usage
 * progress bar, then quick actions for Settings, Rename project, and
 * Appearance (light / dark / system).
 *
 * Opens from either the hamburger button (top-left) or by tapping the
 * centered project name in the header.
 */
import { useMemo } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ChevronRight,
  Settings as SettingsIcon,
  Pencil,
  Sun,
  Moon,
  Monitor as MonitorIcon,
  Sparkles,
  Globe,
} from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { formatCredits } from "@/lib/format-credits";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  onOpenRename: () => void;
  onOpenBilling: () => void;
  onOpenPublish: () => void;
};

export function BuilderActionsSheet({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenRename,
  onOpenBilling,
  onOpenPublish,
}: Props) {
  const { wallet, plan, breakdown, loading } = useWallet();
  const { theme, setTheme } = useTheme();

  // Build a segmented "remaining vs capacity" view so the bar visibly
  // shrinks as the user spends. Capacity = the plan's monthly allotment
  // (or daily-free pool for the Free plan) plus any purchased top-up,
  // so the bar starts full at the beginning of a billing period and
  // never shows >100% when a user tops up.
  const { remaining, capacity, monthlyPct, topupPct, isLow, isEmpty } = useMemo(() => {
    if (!wallet || !plan) {
      return { remaining: 0, capacity: 0, monthlyPct: 0, topupPct: 0, isLow: false, isEmpty: false };
    }
    const baseAllotment =
      plan.monthly_credits > 0 ? plan.monthly_credits : plan.daily_free_credits;
    // Treat the monthly+daily pool together as the "regular" segment, and
    // top-up credits as a distinct segment that extends the bar.
    const regularRemaining = breakdown.monthly + breakdown.daily;
    const topupRemaining = breakdown.topup;
    const total = breakdown.total;
    const cap = Math.max(baseAllotment, regularRemaining) + topupRemaining;
    const mPct = cap > 0 ? Math.min(100, (regularRemaining / cap) * 100) : 0;
    const tPct = cap > 0 ? Math.min(100 - mPct, (topupRemaining / cap) * 100) : 0;
    const lowThreshold = Math.max(5, baseAllotment * 0.15);
    return {
      remaining: total,
      capacity: cap,
      monthlyPct: mPct,
      topupPct: tPct,
      isLow: total > 0 && total <= lowThreshold,
      isEmpty: total <= 0,
    };
  }, [wallet, plan, breakdown.total, breakdown.monthly, breakdown.daily, breakdown.topup]);

  const themeLabel: Record<Theme, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  function cycleTheme() {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }

  // Color the count to telegraph state at a glance, while staying inside
  // the project's existing token palette (no ad-hoc hex values).
  const countTone = isEmpty
    ? "text-destructive"
    : isLow
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">Project menu</DrawerTitle>

        {/* Credits card — premium surface: layered gradient backdrop, hairline
            ring, and a meter with gradient fill + animated sheen so credits
            feel like a living resource rather than a static stat. */}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onOpenBilling();
          }}
          className={cn(
            "group relative mt-2 w-full overflow-hidden rounded-2xl p-4 text-left",
            "bg-gradient-to-br from-card to-muted/70",
            "ring-1 ring-border/70",
            "shadow-[0_1px_0_0_hsl(var(--background)/0.6)_inset,0_8px_24px_-12px_hsl(var(--foreground)/0.18)]",
            "transition-all duration-200 active:scale-[0.99] hover:ring-border",
          )}
        >
          {/* Soft tinted glow that strengthens when the user is low — a quiet
              ambient cue without a banner. */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-300",
              isEmpty
                ? "bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklab,var(--destructive)_18%,transparent),transparent_60%)]"
                : isLow
                  ? "bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklab,#f59e0b_22%,transparent),transparent_60%)]"
                  : "bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_60%)]",
            )}
          />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight">Credits</span>
              {(isLow || isEmpty) && !loading && wallet && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isEmpty ? "bg-destructive" : "bg-amber-500",
                    "animate-pulse",
                  )}
                />
              )}
            </div>
            <span className="flex items-center gap-1 text-sm">
              {loading || !wallet ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className={cn("font-semibold tabular-nums", countTone)}>
                  {formatCredits(remaining)}
                  <span className="ml-1 font-normal text-muted-foreground">left</span>
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>

          {/* Meter — taller, inset track, gradient fill, animated sheen. */}
          <div
            className={cn(
              "relative mt-3.5 flex h-2.5 w-full overflow-hidden rounded-full",
              "bg-foreground/[0.06] ring-1 ring-inset ring-foreground/[0.04]",
              "shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
            )}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(capacity)}
            aria-valuenow={Math.round(remaining)}
            aria-label="Credits remaining"
          >
            <div
              className={cn(
                "credits-meter-fill h-full transition-[width] duration-700 ease-out",
                isEmpty
                  ? "bg-gradient-to-r from-destructive/80 to-destructive"
                  : isLow
                    ? "bg-gradient-to-r from-amber-400 to-amber-500"
                    : "bg-gradient-to-r from-primary to-[color-mix(in_oklab,var(--primary)_70%,white)]",
              )}
              style={{
                width: `${monthlyPct}%`,
                boxShadow: isEmpty
                  ? "0 0 0 0 transparent"
                  : isLow
                    ? "0 0 12px -2px color-mix(in oklab, #f59e0b 60%, transparent)"
                    : "0 0 14px -2px color-mix(in oklab, var(--primary) 55%, transparent)",
              }}
            />
            {topupPct > 0 && (
              <div
                className="credits-meter-fill h-full bg-gradient-to-r from-accent to-[color-mix(in_oklab,var(--accent)_75%,white)] transition-[width] duration-700 ease-out"
                style={{ width: `${topupPct}%` }}
              />
            )}
          </div>

          {plan?.code === "free" && (
            <p
              className={cn(
                "relative mt-2.5 flex items-center gap-1.5 text-xs font-medium",
                isLow || isEmpty ? "text-amber-600 dark:text-amber-400" : "text-primary",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isEmpty
                ? "Out of credits — upgrade to keep building"
                : isLow
                  ? "Running low — upgrade for more monthly credits"
                  : "Upgrade for more monthly credits"}
            </p>
          )}
        </button>

        {/* Quick "Buy credits" CTA — surfaces automatically when the wallet
            drops to 10 or fewer credits so the user can top up in one tap
            without hunting through Settings → Billing. */}
        {!loading && wallet && remaining <= 10 && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onOpenBilling();
            }}
            className={cn(
              "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl",
              "bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
              "shadow-[0_6px_20px_-8px_color-mix(in_oklab,var(--primary)_70%,transparent)]",
              "ring-1 ring-primary/30 transition active:scale-[0.99] hover:brightness-105",
            )}
          >
            <Sparkles className="h-4 w-4" />
            {isEmpty ? "Buy credits to keep building" : "Buy more credits"}
          </button>
        )}

        {/* Actions */}
        <ul className="mt-3 divide-y divide-border/60 rounded-2xl bg-card">
          <ActionRow
            icon={<Globe className="h-5 w-5" />}
            label="Publish"
            onClick={() => {
              onOpenChange(false);
              onOpenPublish();
            }}
          />
          <ActionRow
            icon={<SettingsIcon className="h-5 w-5" />}
            label="Settings"
            onClick={() => {
              onOpenChange(false);
              onOpenSettings();
            }}
          />
          <ActionRow
            icon={<Pencil className="h-5 w-5" />}
            label="Rename project"
            onClick={() => {
              onOpenChange(false);
              onOpenRename();
            }}
          />
          <ActionRow
            icon={
              theme === "dark" ? (
                <Moon className="h-5 w-5" />
              ) : theme === "light" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <MonitorIcon className="h-5 w-5" />
              )
            }
            label="Appearance"
            trailing={
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {themeLabel[theme]}
                <ChevronRight className="h-4 w-4" />
              </span>
            }
            onClick={cycleTheme}
          />
        </ul>
      </DrawerContent>
    </Drawer>
  );
}

function ActionRow({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-muted/60",
        )}
      >
        <span className="text-foreground/80">{icon}</span>
        <span className="flex-1 text-base font-medium">{label}</span>
        {trailing ?? <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
    </li>
  );
}
