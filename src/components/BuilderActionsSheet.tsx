/**
 * BuilderActionsSheet — iOS-style bottom sheet for the mobile builder.
 *
 * Sprint 3 (H9/M3/M9): this sheet no longer defines any action. It renders
 * the shared registry from `@/lib/builder-actions`, so desktop and mobile
 * can never drift apart. It still owns two mobile-only affordances that
 * have no desktop equivalent: the credits row and the appearance cycle.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ChevronDown,
  Sun,
  Moon,
  Monitor as MonitorIcon,
  Sparkles,
  MoreHorizontal,
} from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { formatCredits } from "@/lib/format-credits";
import { actionsForSurface, type BuilderAction } from "@/lib/builder-actions";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The single builder action registry (see `createBuilderActions`). */
  actions: BuilderAction[];
  onOpenBilling: () => void;
  /** M3 — launch checklist, rendered as a full-width row on mobile. */
  readinessSlot?: ReactNode;
};

export function BuilderActionsSheet({
  open,
  onOpenChange,
  actions,
  onOpenBilling,
  readinessSlot,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const { wallet, plan, breakdown, loading } = useWallet();
  const { theme, setTheme } = useTheme();

  const primary = actionsForSurface(actions, "mobile-primary");
  const more = actionsForSurface(actions, "mobile-more");

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

  function runAction(action: BuilderAction) {
    if (action.disabled) return;
    onOpenChange(false);
    action.run();
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
      <DrawerContent className="px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">Project menu</DrawerTitle>

        {/* Credits — a quiet status line, not a card. Tapping opens billing. */}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onOpenBilling();
          }}
          className="group mt-1 w-full rounded-xl px-4 py-3 text-left transition active:bg-muted/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-muted-foreground">Credits</span>
            {loading || !wallet ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <span className={cn("text-sm font-semibold tabular-nums", countTone)}>
                {formatCredits(remaining)}
                <span className="ml-1 font-normal text-muted-foreground">left</span>
              </span>
            )}
          </div>

          <div
            className="mt-2 flex h-1 w-full overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(capacity)}
            aria-valuenow={Math.round(remaining)}
            aria-label="Credits remaining"
          >
            <div
              className={cn(
                "h-full transition-[width] duration-500 ease-out",
                isEmpty ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary",
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

          {!loading && wallet && (isLow || isEmpty) && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {(plan?.code ?? "free") === "free"
                ? "Upgrade for more credits"
                : "Buy more credits"}
            </span>
          )}
        </button>

        {readinessSlot && <div className="px-2 pb-1">{readinessSlot}</div>}

        <div className="mx-4 h-px bg-border/60" />

        {/* Primary actions — registry-driven, so mobile can't drift from desktop. */}
        <ul className="mt-1 max-h-[55vh] overflow-y-auto py-1">
          {primary.map((action) => (
            <ActionRow
              key={action.id}
              icon={<action.icon className="h-5 w-5" />}
              label={action.label}
              disabled={action.disabled}
              onClick={() => runAction(action)}
            />
          ))}

          {/* More — expands in place, mirroring the reference menu. */}
          <ActionRow
            icon={<MoreHorizontal className="h-5 w-5" />}
            label="More"
            trailing={
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  moreOpen && "rotate-180",
                )}
              />
            }
            onClick={() => setMoreOpen((v) => !v)}
          />
          {moreOpen &&
            more.map((action) => (
              <ActionRow
                key={action.id}
                nested
                icon={<action.icon className="h-5 w-5" />}
                label={action.label}
                disabled={action.disabled}
                onClick={() => runAction(action)}
              />
            ))}

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
              <span className="shrink-0 text-sm text-muted-foreground">
                {themeLabel[theme]}
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
  nested,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  /** Indented child row inside the expanded "More" group. */
  nested?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex w-full min-h-[44px] items-center gap-3.5 rounded-xl px-4 py-3 text-left transition active:bg-muted/60 disabled:opacity-40",
          nested && "py-2.5 pl-11",
        )}
      >
        <span className="shrink-0 text-foreground/70">{icon}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            nested ? "text-[15px] text-foreground/90" : "text-[17px]",
          )}
        >
          {label}
        </span>
        {trailing}
      </button>
    </li>
  );
}
