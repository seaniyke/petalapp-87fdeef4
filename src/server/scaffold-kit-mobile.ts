/**
 * Mobile-feel primitives for Petal scaffold.
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
 * iOS/Android-style sticky header. Title is centered, back button on left,
 * optional action on right. Sits below the safe-area top inset.
 */
export function MobileHeader({
  title,
  onBack,
  right,
  className,
}: {
  title?: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/85 px-3 backdrop-blur",
        className,
      )}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex w-12 items-center">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <h1 className="flex-1 truncate text-center text-base font-semibold">{title}</h1>
      <div className="flex w-12 items-center justify-end">{right}</div>
    </header>
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

/**
 * Fixed iOS/Android bottom tab bar. Pass 3-5 tabs. Active tab is highlighted
 * with the primary color. Sits above safe-area-inset-bottom automatically.
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
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const inner = (
            <div
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium transition",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <tab.Icon className={cn("h-5 w-5", active && "scale-110")} />
              <span>{tab.label}</span>
            </div>
          );
          return (
            <li key={tab.key} className="flex-1">
              {tab.href ? (
                <a href={tab.href} className="flex w-full justify-center">{inner}</a>
              ) : (
                <button
                  type="button"
                  onClick={tab.onClick}
                  className="flex w-full justify-center"
                  aria-current={active ? "page" : undefined}
                >
                  {inner}
                </button>
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
