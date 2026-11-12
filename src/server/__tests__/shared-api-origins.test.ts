import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { sharedApiOrigins } from "../backend-connector.server";

describe("shared-tier API addresses baked into generated sites", () => {
  it("puts Petal's primary address first when nothing is configured", () => {
    const { baseUrl, fallbackUrls } = sharedApiOrigins({});
    expect(baseUrl).toBe("https://api.custardai.dev");
    expect(fallbackUrls).toContain("https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app");
  });

  it("never includes kimble.cloud, which answers 404 and blocked the Allure Bar publish", () => {
    const all = (() => {
      const o = sharedApiOrigins({ PETAL_PUBLIC_ORIGIN: "https://kimble.cloud" });
      return [o.baseUrl, ...o.fallbackUrls];
    })();
    expect(all.some((u) => u.includes("kimble.cloud"))).toBe(false);
  });

  it("never includes buildwithpetal.com, which rejects valid project keys", () => {
    const o = sharedApiOrigins({ PETAL_FALLBACK_ORIGINS: "https://buildwithpetal.com" });
    expect([o.baseUrl, ...o.fallbackUrls].some((u) => u.includes("buildwithpetal.com"))).toBe(false);
  });

  it("never includes petalapp.lovable.app, whose redirect breaks browser preflights (amaraglow rollback)", () => {
    const o = sharedApiOrigins({ PETAL_PUBLIC_ORIGIN: "https://petalapp.lovable.app/" });
    expect(o.baseUrl).toBe("https://api.custardai.dev");
    expect([o.baseUrl, ...o.fallbackUrls].some((u) => u.includes("petalapp.lovable.app"))).toBe(false);
  });

  it("keeps a working configured origin first", () => {
    expect(sharedApiOrigins({ PETAL_PUBLIC_ORIGIN: "https://engine.example.com/" }).baseUrl).toBe(
      "https://engine.example.com",
    );
  });
});
