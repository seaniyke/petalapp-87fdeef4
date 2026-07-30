/**
 * ThemeToggle — light / dark / system switcher for the site chrome.
 *
 * Renders nothing until mounted so SSR markup and the client agree (the theme
 * itself is applied pre-hydration by the inline script in __root).
 */
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/use-theme";

const ORDER: Theme[] = ["light", "dark", "system"];
const LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 place-items-center rounded-full ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABEL[theme]} — switch to ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}.`}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-2.5 font-semibold text-foreground transition-colors hover:bg-muted/70 ${className}`}
    >
      <Icon className="h-4 w-4" />
      {showLabel && <span className="text-sm">{LABEL[theme]}</span>}
    </button>
  );
}
