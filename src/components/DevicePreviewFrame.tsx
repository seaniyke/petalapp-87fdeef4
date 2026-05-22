/**
 * Wraps the preview iframe in a target-appropriate chrome:
 *   - iOS:        rounded phone shell, Dynamic Island notch, status bar, home indicator
 *   - Android:    rounded shell, status bar, gesture pill
 *   - api:        request inspector placeholder
 *   - extension:  Chrome toolbar + 360×500 popup card
 *   - web:        no chrome, passthrough
 *
 * Mobile frames include a small control rail (Rotate) so the preview
 * behaves like a real device. Visual scaffolding only — does NOT swap
 * the underlying stack. That's Milestone 3 (Snack web-player integration).
 */
import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import type { PreviewMode } from "@/lib/build-targets";

type Props = {
  mode: PreviewMode;
  children: React.ReactNode;
};

export function DevicePreviewFrame({ mode, children }: Props) {
  if (mode === "web") return <>{children}</>;
  if (mode === "mobile") return <PhoneFrame>{children}</PhoneFrame>;
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

function PhoneFrame({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "ios" | "android";
}) {
  const time = useClock();
  const [landscape, setLandscape] = useState(false);
  const isIOS = variant === "ios";

  // Aspect & shell tuned per platform (iPhone 14 Pro / Pixel 7).
  const portraitW = isIOS ? 390 : 384;
  const portraitH = isIOS ? 844 : 854;
  const w = landscape ? portraitH : portraitW;
  const h = landscape ? portraitW : portraitH;

  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted/40 to-muted/10 p-3">
      <div className="flex flex-col items-center gap-2">
        {/* Controls */}
        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-1.5 py-1 text-[10.5px] text-muted-foreground backdrop-blur">
          <span className="px-1.5 font-medium uppercase tracking-wide">
            {isIOS ? "iOS" : "Android"} · {landscape ? "Landscape" : "Portrait"}
          </span>
          <button
            type="button"
            onClick={() => setLandscape((v) => !v)}
            className="grid h-6 w-6 place-items-center rounded-full transition hover:bg-foreground/10 hover:text-foreground"
            title="Rotate device"
            aria-label="Rotate device"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>

        {/* Device shell */}
        <div
          className={`relative overflow-hidden bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out ${
            isIOS
              ? "rounded-[44px] ring-[6px] ring-zinc-800"
              : "rounded-[36px] ring-[4px] ring-zinc-700"
          }`}
          style={{
            width: `min(${w}px, calc(100vw - 2rem))`,
            aspectRatio: `${w} / ${h}`,
          }}
        >
          {/* Status bar */}
          <div
            className={`relative z-10 flex items-center justify-between px-7 pt-1.5 font-semibold text-white ${
              isIOS ? "h-[44px] text-[12px]" : "h-[28px] px-4 text-[11px]"
            }`}
          >
            <span className="tabular-nums">{time}</span>
            <span className="flex items-center gap-1 text-[10px]">
              <span aria-hidden>▲</span>
              <span aria-hidden>📶</span>
              <span aria-hidden>100%</span>
            </span>
          </div>

          {/* Notch / camera */}
          {isIOS ? (
            <div className="pointer-events-none absolute left-1/2 top-[10px] z-20 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-black" />
          ) : (
            <div className="pointer-events-none absolute left-1/2 top-[8px] z-20 h-[12px] w-[12px] -translate-x-1/2 rounded-full bg-black" />
          )}

          {/* App content */}
          <div
            className={`absolute inset-x-0 bg-background ${
              isIOS ? "bottom-0 top-[44px]" : "bottom-[32px] top-[28px]"
            }`}
          >
            {children}
          </div>

          {/* Home indicator / gesture pill */}
          {isIOS ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-1.5 z-20 flex justify-center">
              <div className="h-[5px] w-[134px] rounded-full bg-white/80" />
            </div>
          ) : (
            <div className="absolute inset-x-0 bottom-0 z-20 flex h-[32px] items-center justify-center bg-zinc-900">
              <div className="h-[4px] w-[100px] rounded-full bg-white/80" />
            </div>
          )}
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
