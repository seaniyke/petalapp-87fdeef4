/**
 * ThemeToggle — light / dark / system switcher for the site chrome.
 *
 * Renders nothing until mounted so SSR markup and the client agree (the theme
 * itself is applied pre-hydration by the inline script in __root).
 *
 * Two shapes:
 *  - `segmented` (default): three icon buttons — Sun / Moon / Monitor.
 *  - `icon`: single round button that flips between light and dark.
 */
import { useEffect, useState } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/use-theme";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: MonitorSmartphone },
];

function resolvedIsDark(theme: Theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function ThemeToggle({
  className = "",
  variant = "segmented",
}: {
  className?: string;
  /** @deprecated kept for older call sites */
  showLabel?: boolean;
  variant?: "segmented" | "icon";
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className={`inline-block h-9 ${variant === "icon" ? "w-9" : "w-[6.75rem]"} rounded-full bg-muted/40 ${className}`}
      />
    );
  }

  if (variant === "icon") {
    const isDark = resolvedIsDark(theme);
    const Icon = isDark ? Moon : Sun;
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-muted/40 text-foreground transition-colors hover:bg-muted/70 ${className}`}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
