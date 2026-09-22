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

export const MOBILE_SHELL_DEPS: Record<string, string> = {
  "@capacitor/core": "^6.2.0",
  "@capacitor/app": "^6.0.2",
  "@capacitor/haptics": "^6.0.2",
  "@capacitor/keyboard": "^6.0.3",
  "@capacitor/preferences": "^6.0.3",
  "@capacitor/status-bar": "^6.0.2",
};

const CAPACITOR_CONFIG = `import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Kimble-managed native shell config. The store build (iOS + Android) runs
 * \`vite build\` and then wraps \`dist/\` with Capacitor using this file.
 * Change appName / appId freely; leave \`webDir\` alone.
 */
const config: CapacitorConfig = {
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

/** Native-feel runtime touches that a webview app needs and a browser app doesn't. */
const NATIVE_RUNTIME = `import { useEffect } from "react";

/**
 * Call once from the app root. Applies the small runtime behaviours that
 * make a webview feel like an app: no rubber-band overscroll on the body,
 * no double-tap zoom, and hardware back handling on Android.
 *
 * Safe on the web — every native call is behind a capability check.
 */
export function useNativeShell() {
  useEffect(() => {
    document.body.style.overscrollBehaviorY = "none";
    let cancelled = false;
    void (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (!cap?.isNativePlatform?.() || cancelled) return;
      try {
        const { App } = await import("@capacitor/app");
        await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.exitApp();
        });
      } catch {
        // Plugin unavailable in this context — ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
`;

export function mobileShellKit(): ProjectFile[] {
  return [
    { path: "capacitor.config.ts", content: CAPACITOR_CONFIG },
    { path: "src/hooks/use-native-shell.ts", content: NATIVE_RUNTIME },
  ];
}
