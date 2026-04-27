/**
 * useTheme — light / dark / system theme switcher with localStorage persistence.
 *
 * Toggles `.dark` on <html> based on the resolved theme. When set to "system",
 * follows the OS preference and reacts to `prefers-color-scheme` changes.
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "petal:theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStored());

  // Apply on mount + whenever theme changes.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  // React to system changes when in "system" mode.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => apply("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
