import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { parseRailwayUsage, railwayWindowCosts } from "@/server/cloud-metering.server";
import { CLOUD_RATE_DEFAULTS as R } from "@/lib/cloud-pricing";
import { detectTierFromIntent } from "@/server/cloud-tier.server";

describe("Railway usage parsing", () => {
  it("sums only the requested service", () => {
    const u = parseRailwayUsage(
      [
        { measurement: "CPU_USAGE", value: 30, tags: { serviceId: "s1" } },
        { measurement: "MEMORY_USAGE_GB", value: 15, tags: { serviceId: "s1" } },
        { measurement: "NETWORK_TX_GB", value: 0.2, tags: { serviceId: "s1" } },
        { measurement: "CPU_USAGE", value: 999, tags: { serviceId: "other" } },
      ],
      "s1",
    );
    expect(u).toEqual({ cpuVcpuMinutes: 30, memoryGbMinutes: 15, diskGbMinutes: 0, egressGb: 0.2 });
  });
  it("falls back to an ESTIMATED hourly cost when usage is unreadable", () => {
    const c = railwayWindowCosts(null, 2, R);
    expect(c[0].basis).toBe("ESTIMATED");
    expect(c[0].costUsd).toBeCloseTo(0.06, 6);
  });
});

describe("infrastructure choice stays with the one decider", () => {
  it("delivery app → shared", () => {
    expect(detectTierFromIntent("A food delivery app with customer sign-up, restaurants, orders and drivers").tier).toBe("kimble");
  });
  it("simple list app → shared", () => {
    expect(detectTierFromIntent("A simple to-do list that saves my tasks").tier).toBe("kimble");
  });
  it("video processing app → Railway compute", () => {
    expect(detectTierFromIntent("An app that uses ffmpeg to transcode uploaded videos").tier).toBe("kimble_compute");
  });
});
