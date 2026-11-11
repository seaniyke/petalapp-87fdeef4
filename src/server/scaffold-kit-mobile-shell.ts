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
 * App code calls only \`native.*\`. Inside the store app, calls go straight to
 * the shell's built-in plugins (the shell injects \`window.Capacitor\`), so the
 * website needs NO native npm packages — this also works when the app loads
 * a live website. In a browser every call uses a web API or a safe fallback:
 * nothing throws, nothing hangs.
 */
type Fn = (...args: any[]) => any;
type Shell = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, Fn>>;
  PluginHeaders?: { name: string }[];
  nativePromise?: (plugin: string, method: string, args?: unknown) => Promise<any>;
  nativeCallback?: (plugin: string, method: string, args: unknown, cb: Fn) => string;
};

function shell(): Shell | undefined {
  if (typeof window === "undefined") return undefined;
  const s = (window as unknown as { Capacitor?: Shell }).Capacitor;
  return s?.isNativePlatform?.() ? s : undefined;
}
const has = (s: Shell, name: string) => !s.PluginHeaders || s.PluginHeaders.some((h) => h.name === name);
async function call<T>(name: string, method: string, args: unknown, fallback: () => T | Promise<T>): Promise<T> {
  const s = shell();
  try {
    const fn = s?.Plugins?.[name]?.[method];
    if (fn) return (await fn(args)) as T;
    if (s?.nativePromise && has(s, name)) return (await s.nativePromise(name, method, args)) as T;
  } catch {
    /* fall through */
  }
  return fallback();
}
function listen(name: string, event: string, cb: Fn): () => void {
  const s = shell();
  const p = s?.Plugins?.[name];
  if (p?.addListener) {
    let h: { remove?: () => void } | undefined;
    void Promise.resolve(p.addListener(event, cb)).then((x) => (h = x));
    return () => h?.remove?.();
  }
  if (!s?.nativeCallback || !has(s, name)) return () => {};
  const id = s.nativeCallback(name, "addListener", { eventName: event }, cb);
  return () => void s.nativePromise?.(name, "removeListener", { eventName: event, callbackId: id }).catch(() => {});
}
/** Shows a link that opened the app (OAuth / payment return) inside the app. */
function openInApp(url: string) {
  try {
    const u = new URL(url);
    const path = u.protocol === "https:" || u.protocol === "http:" ? u.pathname : "/" + (u.host + u.pathname).replace(/^\\/+/, "");
    const next = path + u.search + u.hash;
    if (next !== location.pathname + location.search + location.hash) location.assign(next);
  } catch {
    /* not a link we can open */
  }
}

export type Platform = "ios" | "android" | "web";

export const native = {
  /** True only inside the installed store app. */
  isApp(): boolean {
    return Boolean(shell());
  },
  platform(): Platform {
    const p = shell()?.getPlatform?.();
    return p === "ios" || p === "android" ? p : "web";
  },
  biometrics: {
    /** True when the phone has fingerprint / Face ID set up. */
    async isAvailable(): Promise<boolean> {
      const r = await call<any>("BiometricAuthNative", "checkBiometry", {}, () => null);
      return Boolean(r?.isAvailable);
    },
    /** Shows the phone's fingerprint / Face ID prompt. True only when the person passed. */
    async authenticate(reason = "Confirm it's you", opts: { allowPasscode?: boolean } = {}): Promise<boolean> {
      const args = { reason, androidTitle: reason, cancelTitle: "Cancel", allowDeviceCredential: opts.allowPasscode ?? true };
      return call("BiometricAuthNative", "internalAuthenticate", args, () => false).then((r) => r !== false);
    },
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
  storage: {
    async get(key: string): Promise<string | null> {
      const r = await call<any>("Preferences", "get", { key }, () => ({ value: localStorage.getItem(key) }));
      return r?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await call("Preferences", "set", { key, value }, () => localStorage.setItem(key, value));
    },
  },
  push: {
    /**
     * Asks permission and registers this phone for notifications. Resolves the
     * token to send to your server (APNs on iPhone, FCM on Android), or null.
     */
    async register(): Promise<{ token: string; platform: Platform } | null> {
      if (!shell()) return null;
      const perm = await call<any>("PushNotifications", "requestPermissions", {}, () => null);
      if (perm?.receive !== "granted") return null;
      return new Promise((resolve) => {
        let done = false;
        const finish = (v: { token: string; platform: Platform } | null) => {
          if (done) return;
          done = true;
          offOk();
          offErr();
          resolve(v);
        };
        const offOk = listen("PushNotifications", "registration", (t: { value?: string }) => finish(t?.value ? { token: t.value, platform: native.platform() } : null));
        const offErr = listen("PushNotifications", "registrationError", () => finish(null));
        void call("PushNotifications", "register", {}, () => finish(null));
        setTimeout(() => finish(null), 15000);
      });
    },
    /** A notification arrived while the app was open. */
    onReceived(cb: (n: { title?: string; body?: string; data?: Record<string, unknown> }) => void): () => void {
      return listen("PushNotifications", "pushNotificationReceived", cb);
    },
    /** The person tapped a notification. Opens \`data.url\` in the app by default. */
    onTap(cb: (n: { title?: string; body?: string; data?: Record<string, unknown> }) => void = (n) => typeof n?.data?.url === "string" && openInApp(n.data.url)): () => void {
      return listen("PushNotifications", "pushNotificationActionPerformed", (e: { notification?: any }) => cb(e?.notification ?? {}));
    },
  },
  /** Runs \`onBack\` for the Android back button. Returns an unsubscribe. */
  onBack(onBack: () => void): () => void {
    return listen("App", "backButton", onBack);
  },
  /**
   * Handles links that open or return to the app (https://your-site/... or
   * yourapp://...). By default the page inside the app goes to that path.
   */
  onLinkOpen(handler: (url: string) => void = openInApp): () => void {
    void call<any>("App", "getLaunchUrl", {}, () => null).then((r) => {
      if (!r?.url || sessionStorage.getItem("petal:launch-url") === r.url) return;
      sessionStorage.setItem("petal:launch-url", r.url);
      handler(r.url);
    });
    return listen("App", "appUrlOpen", (e: { url?: string }) => e?.url && handler(e.url));
  },
};

export default native;
`;

/** Native-feel runtime touches that a webview app needs and a browser app doesn't. */
const NATIVE_RUNTIME = `import { useEffect } from "react";
import { native } from "@/lib/native";

/**
 * Call once from the app root: no rubber-band overscroll, Android hardware
 * back, and links that open the app land on the right page. Safe on the web — the bridge no-ops outside the app.
 */
export function useNativeShell() {
  useEffect(() => {
    document.body.style.overscrollBehaviorY = "none";
    const offBack = native.onBack(() => window.history.back());
    const offLinks = native.onLinkOpen();
    return () => {
      offBack();
      offLinks();
    };
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
