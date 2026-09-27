import { describe, expect, it } from "vitest";
import { resolveBuildTarget } from "@/lib/target-inference";
import { BUILD_TARGETS, getBuildTarget, isMobileTarget } from "@/lib/build-targets";
import { pickDynamicSnippets } from "@/server/dynamic-prompts.server";
import { renderStarterKitMap } from "@/server/engine/template-contract";
import { START_IDEAS } from "@/lib/start-ideas";
import { FEATURES, ORDER } from "@/lib/feature-pages";
import { detectIntent } from "@/lib/intent-registry";
import { SURFACES } from "@/lib/kimble-surfaces";

const PROMPTS = [
  "Build me a Chrome extension that summarises pages",
  "Build an iOS app for habit tracking with push notifications",
  "Build a mobile app for iOS and Android",
  "Build a REST API backend for invoices",
];

describe("paused build types (web-only launch)", () => {
  it("every request resolves to web, whatever the header or prompt", () => {
    for (const p of PROMPTS) {
      for (const h of [null, "web", "mobile", "ios", "android", "extension", "backend", "web-mobile"]) {
        expect(resolveBuildTarget(h, p).target).toBe("web");
      }
    }
  });
  it("only the web target is offered", () => {
    expect(BUILD_TARGETS.map((t) => t.id)).toEqual(["web"]);
    expect(getBuildTarget("mobile").id).toBe("web");
    expect(getBuildTarget("extension").systemPromptAddendum).toBe("");
    expect(isMobileTarget("mobile")).toBe(false);
  });
  it("no mobile / extension / API-backend instructions reach the engine", () => {
    for (const p of PROMPTS) {
      const picked = pickDynamicSnippets({ messages: [{ role: "user", content: p }], hasBackend: true, buildTarget: { id: resolveBuildTarget(null, p).target } });
      const text = JSON.stringify(picked);
      expect(text).not.toMatch(/Mobile app craft|Mobile-native aesthetic|Chrome extension craft|mobileApp|mobileNative|chromeExtensionCraft|mobileCraft/);
    }
    expect(renderStarterKitMap()).not.toMatch(/components\/mobile|mobile-app-shell/);
  });
  it("nothing on screen mentions them", () => {
    const ideas = JSON.stringify(START_IDEAS);
    expect(ideas).not.toMatch(/chrome|App Store|Play Store|\biOS\b|\bAndroid\b/i);
    expect(Object.keys(FEATURES)).not.toContain("mobile");
    expect(Object.keys(FEATURES)).not.toContain("extensions");
    expect(ORDER).not.toContain("mobile");
    expect(JSON.stringify(Object.values(FEATURES).map(({ icon, image, ...f }) => f))).not.toMatch(/Expo|\.apk|\.ipa|iOS|Android|Chrome/);
    expect(detectIntent("mobile", "Build a mobile app for the app store").detected).toBe(false);
    expect(SURFACES.some((s) => s.id === "mobile")).toBe(false);
  });
});
