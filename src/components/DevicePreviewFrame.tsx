/**
 * Wraps the preview iframe in a target-appropriate chrome:
 *   - iOS:        rounded phone shell, Dynamic Island notch, status bar, home indicator
 *   - Android:    rounded shell, status bar, gesture pill
 *   - api:        request inspector placeholder
 *   - extension:  Chrome toolbar + 360×500 popup card
 *   - web:        no chrome, passthrough
 *
 * Visual scaffolding only — does NOT swap the underlying stack. That's
 * Milestone 3 (Snack web-player integration).
 */
import { useEffect, useState } from "react";
import type { PreviewMode } from "@/lib/build-targets";

type Props = {
  mode: PreviewMode;
  children: React.ReactNode;
};

export function DevicePreviewFrame({ mode, children }: Props) {
  if (mode === "web") return <>{children}</>;
  if (mode === "ios") return <IOSFrame>{children}</IOSFrame>;
  if (mode === "android") return <AndroidFrame>{children}</AndroidFrame>;
  if (mode === "extension") return <ExtensionFrame>{children}</ExtensionFrame>;
  if (mode === "api") return <ApiFrame>{children}</ApiFrame>;
  return <>{children}</>;
}

function useClock() {
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const t = setInterval(() => setTime(formatTime(new Date())), 30_000);
    return () => clearInterval(t);
  }, []);
  return time;
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function IOSFrame({ children }: { children: React.ReactNode }) {
  const time = useClock();
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted/40 to-muted/10 p-4">
      <div
        className="relative overflow-hidden rounded-[44px] bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] ring-[6px] ring-zinc-800"
        style={{ width: "min(390px, 100%)", aspectRatio: "390 / 844" }}
      >
        {/* Status bar */}
        <div className="relative z-10 flex h-[44px] items-center justify-between px-7 pt-1.5 text-[12px] font-semibold text-white">
          <span className="tabular-nums">{time}</span>
          <span className="flex items-center gap-1">
            <span aria-hidden>􀙇</span>
            <span aria-hidden>􀛨</span>
            <span aria-hidden className="rounded-sm border border-white/70 px-1 text-[9px]">100</span>
          </span>
        </div>
        {/* Dynamic Island */}
        <div className="pointer-events-none absolute left-1/2 top-[10px] z-20 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-black" />
        {/* App content */}
        <div className="absolute inset-x-0 bottom-0 top-[44px] bg-background">
          {children}
        </div>
        {/* Home indicator */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1.5 z-20 flex justify-center">
          <div className="h-[5px] w-[134px] rounded-full bg-white/80" />
        </div>
      </div>
    </div>
  );
}

function AndroidFrame({ children }: { children: React.ReactNode }) {
  const time = useClock();
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted/40 to-muted/10 p-4">
      <div
        className="relative overflow-hidden rounded-[36px] bg-zinc-900 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] ring-[4px] ring-zinc-700"
        style={{ width: "min(384px, 100%)", aspectRatio: "9 / 20" }}
      >
        {/* Status bar */}
        <div className="relative z-10 flex h-[28px] items-center justify-between px-4 text-[11px] font-medium text-white">
          <span className="tabular-nums">{time}</span>
          <span className="flex items-center gap-1.5 text-[10px]">
            <span aria-hidden>▲</span>
            <span aria-hidden>📶</span>
            <span aria-hidden>100%</span>
          </span>
        </div>
        {/* Punch-hole camera */}
        <div className="pointer-events-none absolute left-1/2 top-[8px] z-20 h-[12px] w-[12px] -translate-x-1/2 rounded-full bg-black" />
        {/* App content */}
        <div className="absolute inset-x-0 bottom-[32px] top-[28px] bg-background">
          {children}
        </div>
        {/* Gesture pill */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-[32px] items-center justify-center bg-zinc-900">
          <div className="h-[4px] w-[100px] rounded-full bg-white/80" />
        </div>
      </div>
    </div>
  );
}

function ExtensionFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted/40 to-muted/10 p-4">
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 rounded-md bg-zinc-200 px-2 py-1 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <span aria-hidden>🧩</span> Extension popup
        </div>
        <div
          className="overflow-hidden rounded-lg border border-border/60 bg-background shadow-2xl"
          style={{ width: 360, height: 500 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ApiFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col bg-muted/20">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[11.5px] font-mono text-muted-foreground">
        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
          API
        </span>
        Request inspector — endpoints render here
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
