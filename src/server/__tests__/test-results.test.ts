import { describe, expect, it } from "vitest";
import type { BrowseReport } from "@/server/browse-client.server";
import type { TestCase } from "@/server/test-plan.server";
import {
  blockedResult,
  judgeCase,
  runStatusFor,
  skippedResult,
  tallyResults,
} from "@/server/test-results.server";

const testCase: TestCase = {
  id: "journey-book",
  title: "Create a booking",
  priority: "P0",
  category: "journey",
  actions: [],
  expect: {
    textIncludes: "Cut petal-verify",
    noPageErrors: true,
    textExcludes: ["Application error"],
  },
};

function report(over: Partial<BrowseReport> = {}): BrowseReport {
  return {
    ok: true,
    baseUrl: "https://app.test",
    finalUrl: "https://app.test/dashboard",
    durationMs: 1200,
    steps: [
      { action: "goto", ok: true, durationMs: 300 },
      { action: "text", ok: true, data: "Bookings\nCut petal-verify", durationMs: 20 },
    ],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    ...over,
  };
}

describe("judgeCase", () => {
  it("passes when the expected text is on the page", () => {
    expect(judgeCase(testCase, report()).status).toBe("passed");
  });

  it("fails when the expected text is missing", () => {
    const r = judgeCase(
      testCase,
      report({ steps: [{ action: "text", ok: true, data: "Bookings", durationMs: 10 }] }),
    );
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("Cut petal-verify");
  });

  it("fails on an uncaught page error", () => {
    const r = judgeCase(testCase, report({ pageErrors: ["TypeError: x is not a function"] }));
    expect(r.status).toBe("failed");
    expect(r.pageErrors[0]).toContain("TypeError");
  });

  it("fails when an error screen is rendered", () => {
    const r = judgeCase(
      testCase,
      report({ steps: [{ action: "text", ok: true, data: "Application error", durationMs: 5 }] }),
    );
    expect(r.status).toBe("failed");
  });

  it("blocks — never passes — when the app could not be opened", () => {
    const r = judgeCase(
      testCase,
      report({
        ok: false,
        steps: [{ action: "goto", ok: false, error: "net::ERR_CONNECTION_REFUSED", durationMs: 90 }],
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toContain("Could not open");
  });

  it("keeps screenshots and page text as evidence", () => {
    const r = judgeCase(
      testCase,
      report({
        steps: [
          { action: "text", ok: true, data: "Cut petal-verify", durationMs: 5 },
          { action: "screenshot", ok: true, image: "AAAA", width: 390, durationMs: 50 },
        ],
      }),
    );
    expect(r.images).toEqual([{ data: "AAAA", width: 390 }]);
    expect(r.evidence.pageText).toContain("Cut petal-verify");
  });
});

describe("run verdict", () => {
  it("counts each status separately and tracks P0 damage", () => {
    const totals = tallyResults([
      judgeCase(testCase, report()),
      blockedResult(testCase, "no browser"),
      skippedResult({ ...testCase, priority: "P2", id: "a11y" }, "budget"),
    ]);
    expect(totals).toMatchObject({ passed: 1, blocked: 1, skipped: 1, p0Blocked: 1 });
  });

  it("never reports a pass when a must-work check was blocked", () => {
    expect(runStatusFor(tallyResults([blockedResult(testCase, "no browser")]))).toBe("blocked");
    expect(runStatusFor(tallyResults([judgeCase(testCase, report())]))).toBe("passed");
  });
});
