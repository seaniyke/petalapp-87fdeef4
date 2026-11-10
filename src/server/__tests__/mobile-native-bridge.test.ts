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
    expect(await native.location()).toBeNull();
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

  it("the store build installs every plugin the bridge uses", () => {
    const used = [...bridgeSource().matchAll(/(?:call(?:<[^>]*>)?\(|plugin\()"(\w+)"/g)].map((m) => m[1]);
    const pkg: Record<string, string> = { Haptics: "haptics", Share: "share", Browser: "browser", Geolocation: "geolocation", Preferences: "preferences", App: "app" };
    for (const name of new Set(used)) expect(CODEMAGIC_YAML).toContain(`@capacitor/${pkg[name]}`);
  });

  it("mobile guidance tells the model to use the bridge, never native packages", () => {
    const block = renderMobileGuidanceBlock("build a mobile app", { force: true });
    expect(block).toContain("@/lib/native");
    expect(block).toContain("NEVER import");
  });
});
