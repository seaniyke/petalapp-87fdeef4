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


/**
 * Inside the phone app the marketing landing page never shows. Wrap the root
 * route's content: in the app, signed-out people see the welcome/sign-in
 * screen and signed-in people go to the app home; in a browser nothing changes.
 */
const APP_SURFACE_SWITCH = `import * as React from "react";
import { native } from "@/lib/native";

export function AppSurfaceSwitch({
  isSignedIn,
  appHome = "/dashboard",
  signedOut,
  children,
}: {
  /** null while the session is still loading. */
  isSignedIn: boolean | null;
  appHome?: string;
  /** Shown in the app when signed out — usually <MobileAuthScreen />. */
  signedOut: React.ReactNode;
  /** The public website (landing page). Only ever shown in a browser. */
  children: React.ReactNode;
}) {
  const [inApp, setInApp] = React.useState<boolean | null>(null);
  React.useEffect(() => setInApp(native.isApp()), []);
  React.useEffect(() => {
    if (inApp && isSignedIn) window.location.replace(appHome);
  }, [inApp, isSignedIn, appHome]);
  if (inApp === null) return null;
  if (!inApp) return <>{children}</>;
  if (isSignedIn === false) return <>{signedOut}</>;
  return <div className="min-h-dvh bg-background" />;
}
`;

/** iOS-standard welcome + sign-in: floating logo, frosted card, equal provider buttons. */
const MOBILE_AUTH_SCREEN = `import * as React from "react";
import { native } from "@/lib/native";

type Props = {
  appName: string;
  /** Transparent logo (PNG/SVG, no background). */
  logoSrc?: string;
  tagline?: string;
  onApple?: () => void;
  onGoogle?: () => void;
  onEmail?: () => void;
  /** Return visit with a saved session: unlock with Face ID / fingerprint. */
  onBiometricUnlock?: () => void;
};

export function MobileAuthScreen({ appName, logoSrc, tagline, onApple, onGoogle, onEmail, onBiometricUnlock }: Props) {
  const [canBio, setCanBio] = React.useState(false);
  React.useEffect(() => {
    if (onBiometricUnlock) void native.biometrics.isAvailable().then(setCanBio);
  }, [onBiometricUnlock]);
  const tap = (fn?: () => void) => () => { native.haptics.impact(); fn?.(); };
  const btn = "flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold transition-transform active:scale-[0.98]";
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/30 blur-3xl" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center animate-in fade-in zoom-in-95 duration-700">
        {logoSrc ? <img src={logoSrc} alt="" className="h-24 w-24 object-contain drop-shadow-xl" /> : null}
        <h1 className="mt-6 text-[34px] font-bold tracking-tight text-foreground">{appName}</h1>
        {tagline ? <p className="mt-2 text-[17px] text-muted-foreground">{tagline}</p> : null}
      </div>
      <div className="mx-4 mb-4 space-y-3 rounded-[28px] border border-border/40 bg-card/70 p-5 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-8 duration-500">
        {canBio && onBiometricUnlock ? (
          <button type="button" onClick={tap(onBiometricUnlock)} className={btn + " bg-primary text-primary-foreground"}>Unlock with Face ID</button>
        ) : null}
        {onApple && native.platform() !== "android" ? (
          <button type="button" onClick={tap(onApple)} className={btn + " bg-foreground text-background"}>Continue with Apple</button>
        ) : null}
        {onGoogle ? (
          <button type="button" onClick={tap(onGoogle)} className={btn + " border border-border bg-background text-foreground"}>Continue with Google</button>
        ) : null}
        {onEmail ? (
          <>
            <div className="flex items-center gap-3 py-1 text-[13px] text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <button type="button" onClick={tap(onEmail)} className={btn + " bg-muted text-foreground"}>Continue with email</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
`;

export function mobileShellKit(): ProjectFile[] {
  return [
    { path: "capacitor.config.ts", content: CAPACITOR_CONFIG },
    { path: "src/lib/native.ts", content: NATIVE_BRIDGE },
    { path: "src/hooks/use-native-shell.ts", content: NATIVE_RUNTIME },
    { path: "src/components/mobile/app-surface-switch.tsx", content: APP_SURFACE_SWITCH },
    { path: "src/components/mobile/mobile-auth-screen.tsx", content: MOBILE_AUTH_SCREEN },
  ];
}
