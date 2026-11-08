import { describe, expect, it } from "vitest";
import { applyFlatSharedRate } from "@/server/cloud-metering.server";
import { backendEventPayload, graceExpired, pauseReasonOf, pauseReasonsOf } from "@/server/shared-cloud-pause.server";
import { sharedActiveDays } from "@/server/service-billing.server";
import { activityRange } from "@/routes/api/public/v1/projects/$id.backend";
import { iconExtension, isOwnSiteImageUrl, isPartnerAssetUrl } from "@/lib/site-image-url";
import { ogRenderUrl } from "@/routes/api/public/og-image.$projectId";
import { ECONOMICS_DEFAULTS } from "@/server/economics-config.server";
import { alertDecision, PARTNER_LOW_BALANCE_CREDITS } from "@/server/balance-alert.server";

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
  it("keeps partner and billing pauses separate", () => {
    expect(pauseReasonsOf({ partner_paused: true })).toEqual(["partner"]);
    expect(pauseReasonsOf({ runtime_paused: true, runtime_grace_until: "2026-01-01" })).toEqual(["billing"]);
    expect(pauseReasonsOf({ partner_paused: false, runtime_paused: false })).toEqual([]);
  });
  it("shows both reasons when a partner pause and a billing pause overlap", () => {
    const both = { partner_paused: true, runtime_paused: true, runtime_grace_until: "2026-11-08T00:00:00Z" };
    expect(pauseReasonsOf(both)).toEqual(["partner", "billing"]);
    expect(pauseReasonOf(both)).toBe("both");
  });
  it("status webhook carries projectId, paused, pauseReason(s) and graceUntil", () => {
    const at = new Date("2026-11-08T12:00:00Z");
    expect(
      backendEventPayload("backend.paused", "p1", { runtime_paused: true, runtime_grace_until: "2026-11-08T10:00:00Z" }, at),
    ).toEqual({
      event: "backend.paused",
      projectId: "p1",
      paused: true,
      pauseReason: "billing",
      pauseReasons: ["billing"],
      graceUntil: "2026-11-08T10:00:00Z",
      at: "2026-11-08T12:00:00.000Z",
    });
  });
  it("pauses only after the grace window has passed", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(graceExpired("2026-11-08T11:00:00Z", now)).toBe(true);
    expect(graceExpired("2026-11-09T11:00:00Z", now)).toBe(false);
    expect(graceExpired(null, now)).toBe(false);
  });
});

describe("active days per site", () => {
  const charge = (day: string, delta = -0.55, meter = "cloud_shared") => ({
    delta,
    reason: "runtime_charge",
    created_at: `${day}T03:20:00Z`,
    metadata: { runtime_meter: meter, day },
  });
  it("lists each charged day once, oldest first, with its credits", () => {
    expect(sharedActiveDays([charge("2026-11-09"), charge("2026-11-07"), charge("2026-11-08")])).toEqual([
      { date: "2026-11-07", credits: 0.55 },
      { date: "2026-11-08", credits: 0.55 },
      { date: "2026-11-09", credits: 0.55 },
    ]);
  });
  it("ignores other meters, refunds and build charges", () => {
    expect(
      sharedActiveDays([
        charge("2026-11-08", -1.5, "backend_hour"),
        { delta: 0.55, reason: "runtime_charge", metadata: { runtime_meter: "cloud_shared", day: "2026-11-08" } },
        { delta: -20, reason: "ai_build_charge", created_at: "2026-11-08T10:00:00Z" },
      ]),
    ).toEqual([]);
  });
  it("defaults to the last 30 days and rejects ranges over 366 days", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(activityRange(new URL("https://x/api"), now)).toEqual({ from: "2026-10-10", to: "2026-11-08" });
    expect(activityRange(new URL("https://x/api?from=2026-11-01&to=2026-11-07"), now)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(activityRange(new URL("https://x/api?from=2025-01-01&to=2026-11-07"), now)).toBeNull();
    expect(activityRange(new URL("https://x/api?from=2026-11-07&to=2026-11-01"), now)).toBeNull();
  });
});

describe("partner low-balance email", () => {
  it("emails once when the balance drops below 1,000 credits", () => {
    expect(PARTNER_LOW_BALANCE_CREDITS).toBe(1000);
    expect(alertDecision(999.5, 1000, null)).toBe("send");
    expect(alertDecision(999.5, 1000, "2026-11-08T00:00:00Z")).toBe("none");
  });
  it("stays quiet above 1,000 and re-arms after a top-up", () => {
    expect(alertDecision(10450.96, 1000, null)).toBe("none");
    expect(alertDecision(1000, 1000, null)).toBe("none");
    expect(alertDecision(5000, 1000, "2026-11-08T00:00:00Z")).toBe("rearm");
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
  it("accepts partner logos on custardai.dev only over https", () => {
    expect(isPartnerAssetUrl("https://custardai.dev/logos/amara.png")).toBe(true);
    expect(isPartnerAssetUrl("https://cdn.custardai.dev/amara.png")).toBe(true);
    expect(isPartnerAssetUrl("http://custardai.dev/amara.png")).toBe(false);
    expect(isPartnerAssetUrl("https://custardai.dev.evil.com/amara.png")).toBe(false);
    expect(isPartnerAssetUrl("https://notcustardai.dev/amara.png")).toBe(false);
  });
  it("copies only image types as tab icons", () => {
    expect(iconExtension("image/png")).toBe("png");
    expect(iconExtension("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(iconExtension("image/x-icon")).toBe("ico");
    expect(iconExtension("text/html")).toBeNull();
    expect(iconExtension(null)).toBeNull();
  });
  it("crops the saved screenshot to 1200x630", () => {
    expect(ogRenderUrl("https://x.supabase.co/storage/v1/object/public/petal-images/a.png")).toBe(
      "https://x.supabase.co/storage/v1/render/image/public/petal-images/a.png?width=1200&height=630&resize=cover",
    );
  });
});
