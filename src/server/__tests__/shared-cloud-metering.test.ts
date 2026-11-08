import { describe, expect, it } from "vitest";
import { applyFlatSharedRate } from "@/server/cloud-metering.server";
import { graceExpired, pauseReasonOf } from "@/server/shared-cloud-pause.server";
import { isOwnSiteImageUrl } from "@/lib/site-image-url";
import { ogRenderUrl } from "@/routes/api/public/og-image.$projectId";
import { ECONOMICS_DEFAULTS } from "@/server/economics-config.server";

const base = {
  costs: [{ resource: "cloud_shared", quantity: 10, unit: "rows", costUsd: 0.001, basis: "ALLOCATED" as const }],
  knownCostUsd: 0.001,
  priceUsd: 0.2,
  credits: 1.5,
  marginPct: 50,
};

describe("Shared Cloud flat rate", () => {
  it("defaults to 0.55 credits per active day", () => {
    expect(ECONOMICS_DEFAULTS.cloud_shared_daily_credits).toBe(0.55);
  });
  it("charges 0.55 credits ($0.0825) for one active day", () => {
    const p = applyFlatSharedRate(base, 24, 0.55, 0.15);
    expect(p.credits).toBe(0.55);
    expect(p.priceUsd).toBe(0.0825);
  });
  it("30 active days cost 16.5 credits (~$2.48)", () => {
    expect(Math.round(applyFlatSharedRate(base, 24, 0.55, 0.15).credits * 30 * 100) / 100).toBe(16.5);
  });
});

describe("Shared Cloud pause", () => {
  it("reads billing vs partner pause", () => {
    expect(pauseReasonOf({ runtime_paused: true, runtime_grace_until: "2026-01-01" })).toBe("billing");
    expect(pauseReasonOf({ runtime_paused: true, runtime_grace_until: null })).toBe("partner");
    expect(pauseReasonOf({ runtime_paused: false })).toBeNull();
  });
  it("pauses only after the grace window has passed", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(graceExpired("2026-11-08T11:00:00Z", now)).toBe(true);
    expect(graceExpired("2026-11-09T11:00:00Z", now)).toBe(false);
    expect(graceExpired(null, now)).toBe(false);
  });
});

describe("site-info share image", () => {
  it("accepts https on the site's subdomain or connected domain only", () => {
    expect(isOwnSiteImageUrl("https://amaraglow.sites.custardai.dev/og.png", "amaraglow", [])).toBe(true);
    expect(isOwnSiteImageUrl("https://amaraglow.com/a.jpg", "amaraglow", ["amaraglow.com"])).toBe(true);
    expect(isOwnSiteImageUrl("http://amaraglow.sites.custardai.dev/og.png", "amaraglow", [])).toBe(false);
    expect(isOwnSiteImageUrl("https://evil.com/og.png", "amaraglow", ["amaraglow.com"])).toBe(false);
    expect(isOwnSiteImageUrl("https://other.sites.custardai.dev/og.png", "amaraglow", [])).toBe(false);
  });
  it("crops the saved screenshot to 1200x630", () => {
    expect(ogRenderUrl("https://x.supabase.co/storage/v1/object/public/petal-images/a.png")).toBe(
      "https://x.supabase.co/storage/v1/render/image/public/petal-images/a.png?width=1200&height=630&resize=cover",
    );
  });
});
