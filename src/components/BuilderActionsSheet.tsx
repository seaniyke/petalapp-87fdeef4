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
import { useMemo, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ChevronDown,

  Settings as SettingsIcon,
  Pencil,
  Sun,
  Moon,
  Monitor as MonitorIcon,
  Sparkles,
  Globe,
  Share2,
  Code2,
  Files as FilesIcon,
  History as HistoryIcon,
  MoreHorizontal,
  BarChart3,
  Cloud,
  Bot,
  CreditCard,
  Plug,
  ShieldCheck,
  Search as SearchIcon,
  RotateCw,
  Link2,
  MessageSquare,
  Download,
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
  onOpenShare: () => void;
  onOpenCode: () => void;
  onOpenFiles: () => void;
  onOpenHistory: () => void;
  onOpenAnalytics: () => void;
  onOpenCloud: () => void;
  onOpenAgentIntegrations: () => void;
  onOpenPayments: () => void;
  onOpenConnectors: () => void;
  onOpenSecurity: () => void;
  onOpenSeo: () => void;
  onReloadPreview: () => void;
  onOpenSharePreview: () => void;
  onOpenComments: () => void;
  onExportCode: () => void;
};

export function BuilderActionsSheet({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenRename,
  onOpenBilling,
  onOpenPublish,
  onOpenShare,
  onOpenCode,
  onOpenFiles,
  onOpenHistory,
  onOpenAnalytics,
  onOpenCloud,
  onOpenAgentIntegrations,
  onOpenPayments,
  onOpenConnectors,
  onOpenSecurity,
  onOpenSeo,
  onReloadPreview,
  onOpenSharePreview,
  onOpenComments,
  onExportCode,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

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

        <div className="mx-4 h-px bg-border/60" />


        {/* Primary actions */}
        <ul className="mt-1 py-1">
          <ActionRow
            icon={<Share2 className="h-5 w-5" />}
            label="Share"
            onClick={() => {
              onOpenChange(false);
              onOpenShare();
            }}
          />
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
            icon={<Code2 className="h-5 w-5" />}
            label="Code"
            onClick={() => {
              onOpenChange(false);
              onOpenCode();
            }}
          />
          <ActionRow
            icon={<FilesIcon className="h-5 w-5" />}
            label="Files"
            onClick={() => {
              onOpenChange(false);
              onOpenFiles();
            }}
          />
          <ActionRow
            icon={<HistoryIcon className="h-5 w-5" />}
            label="History"
            onClick={() => {
              onOpenChange(false);
              onOpenHistory();
            }}
          />

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
          {moreOpen && (
            <>
              <ActionRow
                nested
                icon={<BarChart3 className="h-5 w-5" />}
                label="Analytics"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAnalytics();
                }}
              />
              <ActionRow
                nested
                icon={<Cloud className="h-5 w-5" />}
                label="Cloud"
                onClick={() => {
                  onOpenChange(false);
                  onOpenCloud();
                }}
              />
              <ActionRow
                nested
                icon={<Bot className="h-5 w-5" />}
                label="Agent integrations"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAgentIntegrations();
                }}
              />
              <ActionRow
                nested
                icon={<CreditCard className="h-5 w-5" />}
                label="Payments"
                onClick={() => {
                  onOpenChange(false);
                  onOpenPayments();
                }}
              />
              <ActionRow
                nested
                icon={<Plug className="h-5 w-5" />}
                label="Connectors"
                onClick={() => {
                  onOpenChange(false);
                  onOpenConnectors();
                }}
              />
              <ActionRow
                nested
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Security"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSecurity();
                }}
              />
              <ActionRow
                nested
                icon={<SearchIcon className="h-5 w-5" />}
                label="SEO & AI search"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSeo();
                }}
              />
              <ActionRow
                nested
                icon={<RotateCw className="h-5 w-5" />}
                label="Reload preview"
                onClick={() => {
                  onOpenChange(false);
                  onReloadPreview();
                }}
              />
              <ActionRow
                nested
                icon={<Link2 className="h-5 w-5" />}
                label="Share preview link"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSharePreview();
                }}
              />
              <ActionRow
                nested
                icon={<MessageSquare className="h-5 w-5" />}
                label="Visitor feedback"
                onClick={() => {
                  onOpenChange(false);
                  onOpenComments();
                }}
              />
              <ActionRow
                nested
                icon={<Download className="h-5 w-5" />}
                label="Export code"
                onClick={() => {
                  onOpenChange(false);
                  onExportCode();
                }}
              />
            </>
          )}

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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  /** Indented child row inside the expanded "More" group. */
  nested?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-left transition active:bg-muted/60",
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

