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

        {/* Credits card — bar fills with what you HAVE, so it visibly
            shrinks as credits are spent (matches the Lovable model). */}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onOpenBilling();
          }}
          className="mt-2 w-full rounded-2xl bg-muted/60 p-4 text-left transition active:scale-[0.99]"
        >
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold">Credits</span>
            <span className="flex items-center gap-1 text-sm">
              {loading || !wallet ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className={cn("font-medium tabular-nums", countTone)}>
                  {formatCredits(remaining)} left
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </span>
          </div>

          {/* Segmented bar: regular (primary) + top-up (accent). The track
              is the empty/spent portion, so depletion is visually obvious. */}
          <div
            className="relative mt-3 flex h-2 w-full overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(capacity)}
            aria-valuenow={Math.round(remaining)}
            aria-label="Credits remaining"
          >
            <div
              className={cn(
                "h-full transition-[width] duration-500 ease-out",
                isEmpty
                  ? "bg-destructive/70"
                  : isLow
                    ? "bg-amber-500"
                    : "bg-primary",
              )}
              style={{ width: `${monthlyPct}%` }}
            />
            {topupPct > 0 && (
              <div
                className="h-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${topupPct}%` }}
              />
            )}
          </div>

          {plan?.code === "free" && (
            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 text-xs font-medium",
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
