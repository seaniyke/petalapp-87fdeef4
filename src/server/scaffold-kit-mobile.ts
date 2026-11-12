/**
 * Mobile-feel primitives for Kimble scaffold.
 *
 * These are PWA + Capacitor-friendly building blocks that make a generated
 * React app feel like a native iOS/Android app: safe-area aware containers,
 * a fixed bottom tab bar, a sticky native-style header, and pull-to-refresh.
 *
 * Constraints (mirror scaffold-kit-blocks-2.ts):
 *  - ≤ 120 lines / 6 KB per file (file-budget gate).
 *  - Only depend on React + lucide-react + cn + tailwind classes.
 *  - Every export is PascalCase + accepts className.
 *  - Files land at src/components/mobile/* so the model can opt-in
 *    when the user asks for a mobile-feel app.
 *
 * Wired into KIT_FILES via scaffold-kit.ts.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// =============================================================================
// SafeArea — wrapper that respects iOS notch / Android nav bar via env(safe-area-inset-*)
// =============================================================================

const SAFE_AREA = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Wrap the root of any mobile screen in <SafeArea> to add padding for the
 * iOS notch / Android nav bar. Uses CSS env(safe-area-inset-*) which is set
 * automatically by Capacitor and modern PWAs.
 */
export function SafeArea({
  className,
  top = true,
  bottom = true,
  children,
}: {
  className?: string;
  top?: boolean;
  bottom?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("min-h-screen w-full", className)}
      style={{
        paddingTop: top ? "env(safe-area-inset-top)" : undefined,
        paddingBottom: bottom ? "env(safe-area-inset-bottom)" : undefined,
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  );
}
`;

// =============================================================================
// MobileHeader — sticky top bar with back button + title + optional right slot
// =============================================================================

const MOBILE_HEADER = `import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * iOS-style header. With \`large\`, a 34px bold title sits under the bar and
 * collapses into the frosted 44px bar as the page scrolls (iOS large titles).
 */
export function MobileHeader({
  title,
  onBack,
  right,
  large = false,
  className,
}: {
  title?: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
  className?: string;
}) {
  const [scrolled, setScrolled] = React.useState(!large);
  React.useEffect(() => {
    if (!large) return;
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [large]);
  const back = () => {
    try { (window as any).Capacitor?.Plugins?.Haptics?.impact?.({ style: "LIGHT" }); } catch { /* no phone add-on */ }
    onBack?.();
  };
  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 transition-colors duration-200",
          scrolled ? "border-b border-border/40 bg-background/75 backdrop-blur-2xl" : "border-b border-transparent bg-background",
          className,
        )}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-11 items-center justify-between gap-2 px-2">
          <div className="flex w-16 items-center">
            {onBack ? (
              <button type="button" onClick={back} aria-label="Back" className="flex h-11 items-center text-primary active:opacity-50">
                <ChevronLeft className="h-7 w-7" />
              </button>
            ) : null}
          </div>
          <h1 className={cn("flex-1 truncate text-center text-[17px] font-semibold transition-opacity duration-200", scrolled ? "opacity-100" : "opacity-0")}>{title}</h1>
          <div className="flex w-16 items-center justify-end">{right}</div>
        </div>
      </header>
      {large ? (
        <div className="px-4 pb-2 pt-1">
          <h2 className="text-[34px] font-bold leading-tight tracking-tight text-foreground">{title}</h2>
        </div>
      ) : null}
    </>
  );
}
`;

// =============================================================================
// BottomTabBar — fixed bottom nav, 3-5 icon+label tabs
// =============================================================================

const BOTTOM_TAB_BAR = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface BottomTab {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  href?: string;
}

function tick() {
  try {
    const h = (window as any).Capacitor?.Plugins?.Haptics;
    if (h?.selectionChanged) { h.selectionStart?.(); h.selectionChanged(); h.selectionEnd?.(); }
    else navigator.vibrate?.(8);
  } catch { /* no haptics */ }
}

/**
 * Frosted iOS/Android tab bar. Pass 3-5 tabs. Ticks the phone's haptics on
 * tab change and sits above the home indicator automatically.
 */
export function BottomTabBar({
  tabs,
  activeKey,
  className,
}: {
  tabs: BottomTab[];
  activeKey?: string;
  className?: string;
}) {
  return (
    <nav
      className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-border/30 bg-card/75 backdrop-blur-2xl", className)}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const inner = (
            <div className={cn("flex flex-col items-center gap-0.5 px-2 pb-1 pt-2 text-[10px] font-medium transition-transform active:scale-90", active ? "text-primary" : "text-muted-foreground")}>
              <tab.Icon className="h-6 w-6" />
              <span>{tab.label}</span>
            </div>
          );
          const press = () => { if (!active) tick(); tab.onClick?.(); };
          return (
            <li key={tab.key} className="flex-1">
              {tab.href ? (
                <a href={tab.href} onClick={() => { if (!active) tick(); }} className="flex w-full justify-center" aria-current={active ? "page" : undefined}>{inner}</a>
              ) : (
                <button type="button" onClick={press} className="flex w-full justify-center" aria-current={active ? "page" : undefined}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
`;

// =============================================================================
// PullToRefresh — touch-driven refresh wrapper for any scrollable content
// =============================================================================

const PULL_TO_REFRESH = `import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wrap scrollable content. When the user pulls down past the threshold (60px)
 * and releases, onRefresh() is awaited and a small spinner is shown.
 */
export function PullToRefresh({
  onRefresh,
  threshold = 60,
  className,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY > 0 || refreshing) return;
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setPull(Math.min(dy * 0.5, threshold * 1.5));
  };
  const onTouchEnd = async () => {
    if (pull >= threshold) {
      setRefreshing(true);
      try { await onRefresh(); } finally {
        setRefreshing(false);
      }
    }
    setPull(0);
    startY.current = null;
  };

  return (
    <div
      className={cn("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{ transform: \`translateY(\${pull - 32}px)\`, opacity: refreshing || pull > 10 ? 1 : 0 }}
      >
        <RefreshCw className={cn("h-5 w-5 text-primary", refreshing && "animate-spin")} />
      </div>
      <div style={{ transform: \`translateY(\${pull}px)\`, transition: pull === 0 ? "transform 200ms" : undefined }}>
        {children}
      </div>
    </div>
  );
}
`;

// =============================================================================
// MobileScreen — convenience wrapper: SafeArea + Header + scrollable body + tabs
// =============================================================================

const MOBILE_SCREEN = `import * as React from "react";
import { SafeArea } from "@/components/mobile/safe-area";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { BottomTabBar, type BottomTab } from "@/components/mobile/bottom-tab-bar";
import { cn } from "@/lib/utils";

/**
 * One-shot mobile screen scaffold. Pass title + tabs + activeKey and this
 * handles header + safe-area + bottom-tab spacing for the body.
 */
export function MobileScreen({
  title,
  onBack,
  headerRight,
  tabs,
  activeTabKey,
  className,
  children,
}: {
  title?: React.ReactNode;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  tabs?: BottomTab[];
  activeTabKey?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <SafeArea bottom={false}>
      <MobileHeader title={title} onBack={onBack} right={headerRight} />
      <main className={cn("px-4 pt-4", tabs ? "pb-24" : "pb-8", className)}>
        {children}
      </main>
      {tabs ? <BottomTabBar tabs={tabs} activeKey={activeTabKey} /> : null}
    </SafeArea>
  );
}
`;

// =============================================================================
// Example — full mobile-app shell composing the primitives
// =============================================================================

const EXAMPLE_MOBILE_APP = `import * as React from "react";
import { Home, Heart, User, Settings } from "lucide-react";
import { MobileScreen } from "@/components/mobile/mobile-screen";
import { PullToRefresh } from "@/components/mobile/pull-to-refresh";

/**
 * Reference layout for a native-feel mobile app. Copy-paste this when the
 * user asks for "a mobile app" / "iOS app" / "Android app". Uses BottomTabBar
 * + MobileHeader + SafeArea so the result feels native, not webby.
 */
export function ExampleMobileApp() {
  const [tab, setTab] = React.useState("home");
  const tabs = [
    { key: "home", label: "Home", Icon: Home, onClick: () => setTab("home") },
    { key: "favs", label: "Favorites", Icon: Heart, onClick: () => setTab("favs") },
    { key: "me", label: "Profile", Icon: User, onClick: () => setTab("me") },
    { key: "settings", label: "Settings", Icon: Settings, onClick: () => setTab("settings") },
  ];
  const refresh = async () => {
    await new Promise((r) => setTimeout(r, 700));
  };
  return (
    <MobileScreen title="My App" tabs={tabs} activeTabKey={tab}>
      <PullToRefresh onRefresh={refresh}>
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-lg font-semibold">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This screen is a native-feel mobile shell. Pull down to refresh.
            </p>
          </div>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="rounded-2xl border border-border bg-card p-4">
              <div className="text-sm font-medium">Item {n}</div>
              <div className="text-xs text-muted-foreground">Tap to open</div>
            </div>
          ))}
        </div>
      </PullToRefresh>
    </MobileScreen>
  );
}
`;

export const KIT_BLOCK_FILES_MOBILE: KitFile[] = [
  { path: "src/components/mobile/safe-area.tsx", content: SAFE_AREA, overwrite: true },
  { path: "src/components/mobile/mobile-header.tsx", content: MOBILE_HEADER, overwrite: true },
  { path: "src/components/mobile/bottom-tab-bar.tsx", content: BOTTOM_TAB_BAR, overwrite: true },
  { path: "src/components/mobile/pull-to-refresh.tsx", content: PULL_TO_REFRESH, overwrite: true },
  { path: "src/components/mobile/mobile-screen.tsx", content: MOBILE_SCREEN, overwrite: true },
  { path: "src/components/examples/mobile-app-shell.tsx", content: EXAMPLE_MOBILE_APP, overwrite: true },
];
