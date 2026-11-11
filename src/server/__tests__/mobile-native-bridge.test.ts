import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mobileShellKit, MOBILE_SHELL_DEPS } from "@/server/scaffold-kit-mobile-shell";
import { renderMobileGuidanceBlock } from "@/server/integrations/mobile-guidance.server";
import { CODEMAGIC_YAML } from "@/server/mobile-codemagic-template.server";

const bridgeSource = () => mobileShellKit().find((f) => f.path === "src/lib/native.ts")!.content;

async function loadBridge() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-"));
  const file = join(dir, `native-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, bridgeSource());
  return (await import(file)).native;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Petal native bridge (mobile kit)", () => {
  it("mobile apps ship with no native npm packages", () => {
    expect(MOBILE_SHELL_DEPS).toEqual({});
    for (const f of mobileShellKit()) expect(f.content).not.toMatch(/from\s+["']@capacitor\//);
  });

  it("in a browser, calls fall back instead of throwing", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { open: vi.fn() });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    vi.stubGlobal("navigator", { vibrate: vi.fn() });
    const native = await loadBridge();
    expect(native.isApp()).toBe(false);
    expect(native.platform()).toBe("web");
    expect(await native.share({ url: "https://x.test" })).toBe(false);
    await native.storage.set("k", "v");
    expect(await native.storage.get("k")).toBe("v");
  });

  it("inside the store app, calls reach the shell's plugins", async () => {
    const impact = vi.fn(async () => {});
    const share = vi.fn(async () => ({}));
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { Haptics: { impact }, Share: { share } } },
    });
    const native = await loadBridge();
    expect(native.isApp()).toBe(true);
    expect(native.platform()).toBe("ios");
    native.haptics.impact("heavy");
    expect(await native.share({ title: "t" })).toBe(true);
    expect(impact).toHaveBeenCalledWith({ style: "HEAVY" });
    expect(share).toHaveBeenCalledWith({ title: "t" });
  });

  it("works when the app loads a live website (no plugin registry, only the shell's native channel)", async () => {
    const nativePromise = vi.fn(async (plugin: string, method: string) => {
      if (plugin === "BiometricAuthNative" && method === "checkBiometry") return { isAvailable: true };
      if (plugin === "BiometricAuthNative" && method === "internalAuthenticate") return undefined;
      return {};
    });
    vi.stubGlobal("window", {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {},
        PluginHeaders: [{ name: "Haptics" }, { name: "BiometricAuthNative" }, { name: "App" }],
        nativePromise,
      },
    });
    const native = await loadBridge();
    native.haptics.impact("light");
    expect(nativePromise).toHaveBeenCalledWith("Haptics", "impact", { style: "LIGHT" });
    expect(await native.biometrics.isAvailable()).toBe(true);
    expect(await native.biometrics.authenticate("Unlock Custard")).toBe(true);
    expect(nativePromise).toHaveBeenCalledWith("BiometricAuthNative", "internalAuthenticate", expect.objectContaining({ reason: "Unlock Custard" }));
    // Add-ons the app doesn't include fall back instead of calling into nothing.
    expect(await native.share({ url: "https://x.test" })).toBe(false);
  });

  it("a failed or cancelled fingerprint / Face ID check never counts as passed", async () => {
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: {}, nativePromise: vi.fn(async () => Promise.reject(new Error("userCancel"))) },
    });
    const native = await loadBridge();
    expect(await native.biometrics.authenticate()).toBe(false);
    vi.stubGlobal("window", {});
    expect(await (await loadBridge()).biometrics.authenticate()).toBe(false);
  });

  it("links that open the app (https or app scheme) go to the matching page, launch link only once", async () => {
    const assign = vi.fn();
    const session = new Map<string, string>();
    let urlOpen: ((e: { url: string }) => void) | undefined;
    vi.stubGlobal("location", { pathname: "/", search: "", hash: "", assign });
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v) });
    vi.stubGlobal("window", {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {},
        nativePromise: vi.fn(async (_p: string, m: string) => (m === "getLaunchUrl" ? { url: "https://custardai.dev/pay/done?ref=9" } : {})),
        nativeCallback: vi.fn((_p: string, _m: string, _a: unknown, cb: (e: { url: string }) => void) => ((urlOpen = cb), "id1")),
      },
    });
    const native = await loadBridge();
    native.onLinkOpen();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/pay/done?ref=9"));
    urlOpen!({ url: "custardai://auth/callback?code=abc" });
    expect(assign).toHaveBeenLastCalledWith("/auth/callback?code=abc");
    // A later page load must not jump back to the launch link.
    assign.mockClear();
    native.onLinkOpen();
    await new Promise((r) => setTimeout(r, 10));
    expect(assign).not.toHaveBeenCalled();
  });

  it("the store build installs every plugin the bridge uses", () => {
    const used = [...bridgeSource().matchAll(/(?:call(?:<[^>]*>)?\(|listen\()"(\w+)"/g)].map((m) => m[1]);
    const pkg: Record<string, string> = {
      Haptics: "@capacitor/haptics",
      Share: "@capacitor/share",
      Browser: "@capacitor/browser",
      Preferences: "@capacitor/preferences",
      App: "@capacitor/app",
      BiometricAuthNative: "@aparajita/capacitor-biometric-auth",
      PushNotifications: "@capacitor/push-notifications",
    };
    expect(used).toContain("BiometricAuthNative");
    for (const name of new Set(used)) expect(CODEMAGIC_YAML).toContain(pkg[name]);
  });

  it("phone builds run on Node 22 with one Capacitor major so every add-on matches", () => {
    expect(CODEMAGIC_YAML).not.toContain("node: 20");
    expect(CODEMAGIC_YAML.match(/node: 22/g)?.length).toBe(3);
    for (const m of CODEMAGIC_YAML.matchAll(/@capacitor\/[a-z-]+(@\S+)?/g)) expect(m[1]).toBe("@^8");
  });

  it("phone apps never include location tracking", () => {
    expect(CODEMAGIC_YAML).not.toContain("@capacitor/geolocation");
    expect(bridgeSource()).not.toContain("Geolocation");
  });

  it("mobile guidance tells the model to use the bridge, never native packages", () => {
    const block = renderMobileGuidanceBlock("build a mobile app", { force: true });
    expect(block).toContain("@/lib/native");
    expect(block).toContain("NEVER import");
  });
});

describe("one-runner mobile pipeline", () => {
  it("repository codemagic.yaml matches the template", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("codemagic.yaml", "utf8")).toBe(CODEMAGIC_YAML);
    expect(CODEMAGIC_YAML).toContain('curl -fsS "$PETAL_SOURCE_URL"');
  });

  it("source links verify, and reject other projects, wrong secret and expiry", async () => {
    const { signSourceLink, verifySourceLink } = await import("@/server/mobile-source-token");
    const projectId = "11111111-1111-4111-8111-111111111111";
    const url = new URL(await signSourceLink({ baseUrl: "https://x.test", projectId, secret: "s3", nowSeconds: 1000 }));
    const exp = Number(url.searchParams.get("e"));
    const sig = url.searchParams.get("s")!;
    expect(exp).toBe(1000 + 7200);
    expect(await verifySourceLink({ projectId, exp, sig, secret: "s3", nowSeconds: 1000 })).toBe(true);
    expect(await verifySourceLink({ projectId: "22222222-2222-4222-8222-222222222222", exp, sig, secret: "s3", nowSeconds: 1000 })).toBe(false);
    expect(await verifySourceLink({ projectId, exp, sig, secret: "other", nowSeconds: 1000 })).toBe(false);
    expect(await verifySourceLink({ projectId, exp, sig, secret: "s3", nowSeconds: exp + 1 })).toBe(false);
  });
});

describe("store build: fingerprint / Face ID", () => {
  it("installs the biometric plugin and the Face ID permission text", () => {
    expect(CODEMAGIC_YAML).toContain("@aparajita/capacitor-biometric-auth");
    expect(CODEMAGIC_YAML).toContain("NSFaceIDUsageDescription");
  });
});

describe("store build: phone features are registered", () => {
  it("saves the shell's add-ons to package.json so the phone app actually includes them", () => {
    // `cap sync` only registers add-ons listed in package.json; --no-save shipped an app with none.
    expect(CODEMAGIC_YAML).not.toMatch(/@capacitor\/haptics[^\n]*--no-save/);
    expect(CODEMAGIC_YAML).toMatch(/@capacitor\/haptics[^\n]*--save/);
  });
});

describe("store build: per-app phone settings", () => {
  it("adds microphone, app links and launch colour only from the app's own settings", () => {
    const step = CODEMAGIC_YAML.split("- name: Apply app settings")[1].split("- name:")[0];
    expect(CODEMAGIC_YAML.match(/- name: Apply app settings/g)?.length).toBe(3);
    expect(step).toContain("petal.native.json");
    expect(step).toContain("android.permission.RECORD_AUDIO");
    expect(step).toContain("android.permission.MODIFY_AUDIO_SETTINGS");
    expect(step).toContain("NSMicrophoneUsageDescription");
    expect(step).toContain('android:autoVerify="true"');
    expect(step).toContain("windowSplashScreenBackground");
    // Store-safe list only: no location, phone-state or ad permissions can be switched on.
    expect(step).not.toMatch(/LOCATION|READ_PHONE_STATE|AD_ID/);
  });
});

describe("push notifications", () => {
  it("are opt-in per app and need Firebase on Android", async () => {
    const { CODEMAGIC_YAML } = await import("../mobile-codemagic-template.server");
    expect(CODEMAGIC_YAML).toContain("'push': (['android.permission.POST_NOTIFICATIONS']");
    expect(CODEMAGIC_YAML).toMatch(/grep -q '"push"' petal\.native\.json .*google-services\.json.*push-notifications@\^8/);
    expect(CODEMAGIC_YAML).toContain("aps-environment");
    expect(CODEMAGIC_YAML).toContain("PUSH_NOTIFICATIONS");
  });
  it("bridge returns null outside the app", async () => {
    const src = mobileShellKit().find((f) => f.path === "src/lib/native.ts")!.content;
    expect(src).toContain('"PushNotifications", "register"');
    expect(src).toContain("pushNotificationActionPerformed");
  });
});

describe("sign in with Apple", () => {
  it("is opt-in per app: iPhone entitlement plus the Apple capability, nothing on Android", async () => {
    const { CODEMAGIC_YAML } = await import("../mobile-codemagic-template.server");
    expect(CODEMAGIC_YAML).toContain("'apple-signin': ([], '', '')");
    expect(CODEMAGIC_YAML).toContain("<key>com.apple.developer.applesignin</key><array><string>Default</string></array>");
    expect(CODEMAGIC_YAML).toContain('grep -q \'"apple-signin"\' petal.native.json 2>/dev/null; then CAPS="$CAPS APPLE_ID_AUTH"');
    // Push keeps working alongside it in the same entitlements file.
    expect(CODEMAGIC_YAML).toContain('CAPS="$CAPS PUSH_NOTIFICATIONS"');
  });
});

import { readFileSync as __rf } from "node:fs";
describe("native scroll polish", () => {
  it("phone builds hide scrollbars and edge glow/bounce", () => {
    const y = __rf("codemagic.yaml", "utf8");
    for (const s of ["setVerticalScrollBarEnabled(false)", "setHorizontalScrollBarEnabled(false)", "OVER_SCROLL_NEVER", "showsVerticalScrollIndicator = false", "showsHorizontalScrollIndicator = false", "bounces = false"]) expect(y).toContain(s);
  });
});

describe("iPhone push token callbacks", () => {
  it("every iPhone workflow forwards Apple's device token to Capacitor when push is on", () => {
    for (const y of [__rf("codemagic.yaml", "utf8"), CODEMAGIC_YAML_SRC()]) {
      expect(y.split("capacitorDidRegisterForRemoteNotifications, object: deviceToken").length - 1).toBe(3);
      expect(y.split("capacitorDidFailToRegisterForRemoteNotifications, object: error").length - 1).toBe(3);
    }
  });
});
function CODEMAGIC_YAML_SRC() { return __rf("src/server/mobile-codemagic-template.server.ts", "utf8"); }

describe("sign-in add-ons: Google (GoogleAuth) and Apple (SignInWithApple)", () => {
  it("installs each add-on only when the app's settings ask for it", () => {
    expect(CODEMAGIC_YAML.match(/grep -q '"apple-signin"' petal\.native\.json 2>\/dev\/null; then npm install @capacitor-community\/apple-sign-in@\^7 --save/g)?.length).toBe(3);
    expect(CODEMAGIC_YAML.match(/grep -q '"google-signin"' petal\.native\.json 2>\/dev\/null; then npm install @codetrix-studio\/capacitor-google-auth@3\.4\.0-rc\.4 --save --legacy-peer-deps/g)?.length).toBe(3);
    // Its Android build file still points at the retired jcenter repository.
    expect(CODEMAGIC_YAML).toContain("s/jcenter()/mavenCentral()/g");
  });

  it("uses CocoaPods on iPhone for Google sign-in (the add-on has no Swift package) and builds either project type", () => {
    expect(CODEMAGIC_YAML.match(/grep -q '"google-signin"' petal\.native\.json 2>\/dev\/null; then PM="--packagemanager CocoaPods"; fi/g)?.length).toBe(3);
    expect(CODEMAGIC_YAML.match(/npx cap add "\$PETAL_PLATFORM" \$PM/g)?.length).toBe(3);
    expect(CODEMAGIC_YAML).not.toMatch(/xcodebuild -workspace App\.xcworkspace/);
    expect(CODEMAGIC_YAML.match(/build-ipa --project App\.xcodeproj/g)?.length).toBe(2);
  });

  it("writes the Google client IDs into the Android app, using the Web client ID for sign-in", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const step = CODEMAGIC_YAML.split("- name: Apply app settings")[1];
    const py = step.split("python3 - <<'PY'\n")[1].split("\n          PY")[0].replace(/^ {10}/gm, "");
    const dir = mkdtempSync(join(tmpdir(), "petal-google-"));
    mkdirSync(join(dir, "android/app/src/main/assets"), { recursive: true });
    const ios = "111111111111-iosabc.apps.googleusercontent.com";
    const web = "111111111111-webxyz.apps.googleusercontent.com";
    writeFileSync(join(dir, "capacitor.config.json"), JSON.stringify({ appId: "dev.custardai.app" }));
    writeFileSync(join(dir, "android/app/src/main/assets/capacitor.config.json"), JSON.stringify({ appId: "dev.custardai.app" }));
    writeFileSync(join(dir, "android/app/src/main/AndroidManifest.xml"), "<manifest><application><activity></activity></application></manifest>");
    writeFileSync(join(dir, "petal.native.json"), JSON.stringify({
      features: ["push", "apple-signin", "google-signin"],
      google: { iosClientId: ios, androidClientId: "not-a-client-id", webClientId: web },
    }));
    const r = spawnSync("python3", ["-"], { cwd: dir, input: py, env: { ...process.env, PETAL_PLATFORM: "android" }, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const g = JSON.parse(readFileSync(join(dir, "android/app/src/main/assets/capacitor.config.json"), "utf8")).plugins.GoogleAuth;
    expect(g.androidClientId).toBe(web);
    expect(g.serverClientId).toBe(web);
    expect(g.iosClientId).toBe(ios);
    expect(g.scopes).toEqual(["profile", "email"]);
    // Malformed values are never written, and no Google URL scheme is added on Android.
    expect(readFileSync(join(dir, "android/app/src/main/AndroidManifest.xml"), "utf8")).not.toContain("googleusercontent");
  });

  it("adds the reversed iPhone client ID as the app's Google return scheme", () => {
    expect(CODEMAGIC_YAML).toContain("schemes.append('com.googleusercontent.apps.' + g['iosClientId'][:-len('.apps.googleusercontent.com')])");
  });
});
