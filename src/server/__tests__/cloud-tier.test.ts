import { describe, expect, it } from "vitest";
import { detectTierFromIntent, highestTier } from "@/server/cloud-tier.server";

describe("detectTierFromIntent", () => {
  it("defaults a plain CRUD app to the shared tier", () => {
    const s = detectTierFromIntent("A habit tracker with sign-in and a dashboard of streaks");
    expect(s.tier).toBe("kimble");
    expect(s.matched).toEqual([]);
  });

  it("picks the dedicated database when the app needs storage", () => {
    const s = detectTierFromIntent("Users upload photos of receipts and tag them");
    expect(s.tier).toBe("kimble_plus");
    expect(s.matched).toContain("file storage");
  });

  it("picks the dedicated database for realtime", () => {
    expect(detectTierFromIntent("A chat app with real-time updates").tier).toBe("kimble_plus");
  });

  it("picks compute for media processing", () => {
    const s = detectTierFromIntent("Upload a video and transcode it to 720p with ffmpeg");
    expect(s.tier).toBe("kimble_compute");
    expect(s.matched).toContain("video processing");
  });

  it("picks compute for scheduled scraping", () => {
    expect(detectTierFromIntent("A web scraper that runs every hour").tier).toBe("kimble_compute");
  });

  it("picks compute over plus when both are implied", () => {
    const s = detectTierFromIntent("Users upload files and a background worker processes them");
    expect(s.tier).toBe("kimble_compute");
  });

  it("never crashes on empty input", () => {
    expect(detectTierFromIntent("").tier).toBe("kimble");
  });
});

describe("highestTier", () => {
  it("never drops a project down a tier", () => {
    expect(highestTier("kimble_compute", "kimble")).toBe("kimble_compute");
    expect(highestTier("kimble", "kimble_plus")).toBe("kimble_plus");
    expect(highestTier("kimble", "kimble")).toBe("kimble");
  });
});
