import { describe, expect, it } from "vitest";
import {
  MAX_BROWSE_ACTIONS,
  runBrowseSession,
  summarizeBrowseReport,
  type BrowseReport,
} from "@/server/browse-client.server";

const baseReport: BrowseReport = {
  ok: false,
  baseUrl: "https://example.test",
  finalUrl: "https://example.test/login",
  durationMs: 1234,
  steps: [
    { action: "goto", ok: true, url: "https://example.test/login", durationMs: 300 },
    { action: "click", ok: false, error: "locator timeout", durationMs: 900 },
    { action: "screenshot", ok: true, image: "data:image/jpeg;base64,AAAA", width: 390, durationMs: 34 },
  ],
  consoleErrors: ["Uncaught TypeError: x is not a function"],
  pageErrors: [],
  failedRequests: ["500 https://api.test/session"],
};

describe("summarizeBrowseReport", () => {
  it("reports failures and evidence without inlining screenshot bytes", () => {
    const text = summarizeBrowseReport(baseReport);
    expect(text).toContain("FAILED click");
    expect(text).toContain("locator timeout");
    expect(text).toContain("500 https://api.test/session");
    expect(text).toContain("[screenshot captured at 390px]");
    expect(text).not.toContain("base64,AAAA");
  });
});

describe("runBrowseSession guards", () => {
  it("rejects an empty batch", async () => {
    await expect(
      runBrowseSession({ projectId: crypto.randomUUID(), baseUrl: "https://x.test", actions: [] }),
    ).rejects.toThrow(/not configured|No browser actions/);
  });

  it("rejects an oversized batch", async () => {
    process.env.BUILDER_URL = "https://builder.test";
    process.env.BUILDER_SHARED_SECRET = "secret";
    const actions = Array.from({ length: MAX_BROWSE_ACTIONS + 1 }, () => ({
      action: "text" as const,
    }));
    await expect(
      runBrowseSession({ projectId: crypto.randomUUID(), baseUrl: "https://x.test", actions }),
    ).rejects.toThrow(/Too many browser actions/);
    delete process.env.BUILDER_URL;
    delete process.env.BUILDER_SHARED_SECRET;
  });
});
