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
};

export function BuilderActionsSheet({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenRename,
  onOpenBilling,
}: Props) {
  const { wallet, plan, breakdown, loading } = useWallet();
  const { theme, setTheme } = useTheme();

  // Compute a usage bar: credits remaining vs the plan's monthly allotment
  // (or daily-free for free plan). Caps at 1 to avoid overflow when topup
  // exceeds the base allotment.
  const { used, total } = useMemo(() => {
    if (!wallet || !plan) return { used: 0, total: 0 };
    const allotment = plan.monthly_credits > 0
      ? plan.monthly_credits
      : plan.daily_free_credits;
    if (allotment <= 0) return { used: 0, total: 0 };
    const remaining = breakdown.total;
    const usedAmt = Math.max(0, allotment - remaining);
    return { used: usedAmt, total: allotment };
  }, [wallet, plan, breakdown.total]);

  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;

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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">Project menu</DrawerTitle>

        {/* Credits card */}
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
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              {loading || !wallet
                ? "—"
                : `${formatCredits(breakdown.total)} left`}
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {plan?.code === "free" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Upgrade for more monthly credits
            </p>
          )}
        </button>

        {/* Actions */}
        <ul className="mt-3 divide-y divide-border/60 rounded-2xl bg-card">
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
