/**
 * Mobile shell kit — injected when the project's build target is `mobile`
 * (or the legacy `ios` / `android` ids).
 *
 * Kimble ships native apps by building the React app and wrapping it in a
 * Capacitor shell on Codemagic (see `mobile-codemagic-template.server.ts`).
 * That pipeline needs two things to exist in the project before a store
 * build can run:
 *
 *   1. `capacitor.config.ts` — app id / name / webDir, plus the plugin
 *      config the shell template expects.
 *   2. Capacitor deps in package.json so `npx cap sync` resolves.
 *
 * Both are scaffold-owned: the model never has to reproduce them, and a
 * mobile project can never reach the store pipeline without them.
 */
import type { ProjectFile } from "@/server/generate.server";

/**
 * The app ships NO native npm packages: it talks to the phone only through
 * `src/lib/native.ts`, and the store build adds the open-source shell and its
 * plugins (see mobile-codemagic-template.server.ts). Kept as an export so the
 * scaffold call sites stay unchanged.
 */
export const MOBILE_SHELL_DEPS: Record<string, string> = {};

const CAPACITOR_CONFIG = `/**
 * Kimble-managed native shell config. The store build (iOS + Android) runs
 * \`vite build\` and then wraps \`dist/\` with Capacitor using this file.
 * Change appName / appId freely; leave \`webDir\` alone.
 */
const config = {
  appId: "app.petal.mobile",
  appName: "Kimble App",
  webDir: "dist",
  ios: { contentInset: "always" },
  android: { backgroundColor: "#ffffff" },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: "#ffffff" },
    Keyboard: { resize: "body" },
  },
};

export default config;
`;

const NATIVE_BRIDGE = `/**
 * Petal native bridge — the one door from app code to the phone.
 *
 * App code calls only \`native.*\`. Inside the store build, calls go to the
 * open-source shell's plugins through the global plugin registry the shell
 * injects (\`window.Capacitor.Plugins\`), so the app itself needs NO native
 * npm packages. In a browser or the Petal preview, every call uses a real
 * web API or a safe fallback — nothing throws, nothing hangs.
 */
type Plugin = Record<string, (...args: any[]) => Promise<any>>;
type Shell = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, Plugin> };

function shell(): Shell | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: Shell }).Capacitor;
}
function plugin(name: string): Plugin | undefined {
  const s = shell();
  return s?.isNativePlatform?.() ? s.Plugins?.[name] : undefined;
}
async function call<T>(name: string, method: string, args: unknown, fallback: () => T | Promise<T>): Promise<T> {
  const fn = plugin(name)?.[method];
  if (!fn) return fallback();
  try {
    return (await fn(args)) as T;
  } catch {
    return fallback();
  }
}

export type Platform = "ios" | "android" | "web";

export const native = {
  /** True only inside the installed store app. */
  isApp(): boolean {
    return Boolean(shell()?.isNativePlatform?.());
  },
  platform(): Platform {
    const p = shell()?.getPlatform?.();
    return p === "ios" || p === "android" ? p : "web";
  },
  haptics: {
    impact(style: "light" | "medium" | "heavy" = "medium") {
      void call("Haptics", "impact", { style: style.toUpperCase() }, () => {
        if (typeof navigator !== "undefined") navigator.vibrate?.(style === "light" ? 8 : style === "medium" ? 15 : 25);
      });
    },
    success() {
      void call("Haptics", "notification", { type: "SUCCESS" }, () => {
        if (typeof navigator !== "undefined") navigator.vibrate?.([10, 40, 10]);
      });
    },
  },
  async share(data: { title?: string; text?: string; url?: string }): Promise<boolean> {
    return call("Share", "share", data, async () => {
      if (typeof navigator === "undefined" || !navigator.share) return false;
      try {
        await navigator.share(data);
        return true;
      } catch {
        return false;
      }
    }).then((r) => r !== false);
  },
  /** Opens an outside link without killing the app on iOS. */
  async openUrl(url: string): Promise<void> {
    await call("Browser", "open", { url }, () => {
      window.open(url, "_blank", "noopener");
    });
  },
  async location(): Promise<{ lat: number; lng: number } | null> {
    const pos = await call<any>("Geolocation", "getCurrentPosition", { enableHighAccuracy: true }, () =>
      new Promise((resolve) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { timeout: 10_000 });
      }),
    );
    return pos?.coords ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  },
  storage: {
    async get(key: string): Promise<string | null> {
      const r = await call<any>("Preferences", "get", { key }, () => ({ value: localStorage.getItem(key) }));
      return r?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await call("Preferences", "set", { key, value }, () => localStorage.setItem(key, value));
    },
  },
  /** Runs \`onBack\` for the Android back button. Returns an unsubscribe. */
  onBack(onBack: () => void): () => void {
    const app = plugin("App");
    if (!app?.addListener) return () => {};
    let handle: { remove?: () => void } | undefined;
    void app.addListener("backButton", onBack).then((h: { remove?: () => void }) => (handle = h));
    return () => handle?.remove?.();
  },
};

export default native;
`;

/** Native-feel runtime touches that a webview app needs and a browser app doesn't. */
const NATIVE_RUNTIME = `import { useEffect } from "react";
import { native } from "@/lib/native";

/**
 * Call once from the app root: no rubber-band overscroll and Android
 * hardware back. Safe on the web — the bridge no-ops outside the app.
 */
export function useNativeShell() {
  useEffect(() => {
    document.body.style.overscrollBehaviorY = "none";
    return native.onBack(() => window.history.back());
  }, []);
}
`;

export function mobileShellKit(): ProjectFile[] {
  return [
    { path: "capacitor.config.ts", content: CAPACITOR_CONFIG },
    { path: "src/lib/native.ts", content: NATIVE_BRIDGE },
    { path: "src/hooks/use-native-shell.ts", content: NATIVE_RUNTIME },
  ];
}
