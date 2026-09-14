import { describe, expect, it } from "vitest";
import {
  TEST_LIMITS,
  chooseDiagnosisModel,
  chooseTestBudget,
  describeSpend,
  estimateRunCostUsd,
  shouldAskAi,
  shouldOpenBrowser,
} from "../test-cost.server";

describe("chooseTestBudget", () => {
  it("gives paid accounts the full plan", () => {
    expect(chooseTestBudget({ paid: true, degrade: false, attempt: 0 })).toBe("full");
  });

  it("keeps free accounts tight but complete on must-work checks", () => {
    expect(chooseTestBudget({ paid: false, degrade: false, attempt: 0 })).toBe("tight");
  });

  it("drops to must-work only when a free account is over the ceiling", () => {
    expect(chooseTestBudget({ paid: false, degrade: true, attempt: 0 })).toBe("minimal");
  });

  it("never degrades a paid account", () => {
    expect(chooseTestBudget({ paid: true, degrade: true, attempt: 0 })).toBe("full");
  });

  it("retests are tight, not exploratory", () => {
    expect(chooseTestBudget({ paid: true, degrade: false, attempt: 1 })).toBe("tight");
  });

  it("falls back to must-work when the run is already long", () => {
    expect(
      chooseTestBudget({ paid: true, degrade: false, attempt: 0, elapsedMs: TEST_LIMITS.maxRunMs }),
    ).toBe("minimal");
  });
});

describe("shouldOpenBrowser", () => {
  it("does not drive a browser when nothing shipped", () => {
    expect(shouldOpenBrowser({ priority: "P0", shipped: false, sessionsUsed: 0 }).run).toBe(false);
  });

  it("skips cases the build checks already proved broken", () => {
    const d = shouldOpenBrowser({ priority: "P0", shipped: true, knownFailure: true, sessionsUsed: 0 });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("already proven broken");
  });

  it("stops once the session budget is spent", () => {
    expect(
      shouldOpenBrowser({ priority: "P0", shipped: true, sessionsUsed: TEST_LIMITS.maxSessions }).run,
    ).toBe(false);
  });

  it("opens for a normal must-work case", () => {
    expect(shouldOpenBrowser({ priority: "P0", shipped: true, sessionsUsed: 1 }).run).toBe(true);
  });
});

describe("shouldAskAi", () => {
  it("never reviews a passing case", () => {
    expect(shouldAskAi({ status: "passed", priority: "P0", hasScreenshot: true, reviewsUsed: 0 }).run).toBe(false);
  });

  it("never reviews a cosmetic case", () => {
    expect(shouldAskAi({ status: "failed", priority: "P2", hasScreenshot: true, reviewsUsed: 0 }).run).toBe(false);
  });

  it("needs a screenshot to reason about", () => {
    expect(shouldAskAi({ status: "failed", priority: "P0", hasScreenshot: false, reviewsUsed: 0 }).run).toBe(false);
  });

  it("reviews a failed must-work case with a picture", () => {
    expect(shouldAskAi({ status: "failed", priority: "P0", hasScreenshot: true, reviewsUsed: 0 }).run).toBe(true);
  });

  it("respects the review cap", () => {
    expect(
      shouldAskAi({
        status: "failed",
        priority: "P0",
        hasScreenshot: true,
        reviewsUsed: TEST_LIMITS.maxAiReviews,
      }).run,
    ).toBe(false);
  });
});

describe("chooseDiagnosisModel", () => {
  it("starts cheap", () => {
    expect(chooseDiagnosisModel({ repeats: 0 }).tier).toBe("fast");
  });

  it("escalates when the cheap fix did not hold", () => {
    expect(chooseDiagnosisModel({ repeats: 1 }).tier).toBe("strong");
  });

  it("escalates for visual questions and unusable answers", () => {
    expect(chooseDiagnosisModel({ repeats: 0, visual: true }).tier).toBe("strong");
    expect(chooseDiagnosisModel({ repeats: 0, lowConfidence: true }).tier).toBe("strong");
  });
});

describe("cost reporting", () => {
  it("estimates a run cost", () => {
    expect(estimateRunCostUsd({ sessions: 2, screenshots: 4, aiReviews: 1 })).toBeCloseTo(
      2 * 0.004 + 4 * 0.0002 + 0.006,
      6,
    );
  });

  it("summarises spend for the internal record", () => {
    const line = describeSpend({ sessions: 1, screenshots: 2, aiReviews: 0, budget: "tight" });
    expect(line).toContain("test budget tight");
    expect(line).toContain("1 browser batch,");
    expect(line).toContain("0 AI reviews");
  });
});
