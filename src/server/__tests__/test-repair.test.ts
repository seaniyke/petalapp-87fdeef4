import { describe, expect, it } from "vitest";
import {
  defectsFromResults,
  fingerprintDefects,
  interventionFor,
  nextRepairStep,
  retestSelection,
} from "@/server/test-repair.server";
import type { CaseResult } from "@/server/test-results.server";
import type { TestCase } from "@/server/test-plan.server";

function result(over: Partial<CaseResult> & Pick<CaseResult, "caseKey">): CaseResult {
  return {
    title: "Home page loads",
    priority: "P0",
    category: "route",
    status: "passed",
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    images: [],
    evidence: {} as CaseResult["evidence"],
    ...over,
  };
}

function testCase(id: string, priority: TestCase["priority"] = "P0"): TestCase {
  return { id, title: id, priority, category: "route", actions: [], expect: {} as never };
}

describe("interventionFor", () => {
  it("spots a missing key and names the case", () => {
    const found = interventionFor([
      result({ caseKey: "c1", status: "failed", reason: "Missing API key for maps" }),
    ]);
    expect(found?.kind).toBe("missing_credential");
    expect(found?.caseKey).toBe("c1");
  });

  it("spots a captcha wall", () => {
    expect(
      interventionFor([
        result({ caseKey: "c2", status: "failed", actual: "Please complete the reCAPTCHA" }),
      ])?.kind,
    ).toBe("captcha");
  });

  it("ignores passing and skipped cases", () => {
    expect(
      interventionFor([
        result({ caseKey: "ok", status: "passed", reason: "missing api key" }),
        result({ caseKey: "sk", status: "skipped", reason: "captcha" }),
      ]),
    ).toBeNull();
  });

  it("returns null for an ordinary failure", () => {
    expect(
      interventionFor([
        result({ caseKey: "c3", status: "failed", reason: "Button did not navigate" }),
      ]),
    ).toBeNull();
  });
});

describe("defectsFromResults", () => {
  it("splits must-work failures from the rest and attaches evidence", () => {
    const { blocking, advisory } = defectsFromResults([
      result({
        caseKey: "c1",
        status: "failed",
        priority: "P0",
        title: "Sign in works",
        url: "/auth",
        reason: "stayed on the sign-in page",
        expected: "redirect to /dashboard",
        pageErrors: ["TypeError: x is not a function"],
      }),
      result({ caseKey: "c2", status: "failed", priority: "P2", title: "Footer link" }),
      result({ caseKey: "c3", status: "passed" }),
    ]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toContain("/auth");
    expect(blocking[0]).toContain("TypeError");
    expect(advisory).toHaveLength(1);
  });
});

describe("retestSelection", () => {
  it("re-runs failures, blocked cases and previously passing must-work cases", () => {
    const cases = [testCase("a"), testCase("b"), testCase("c", "P2"), testCase("d", "P1")];
    const picked = retestSelection(cases, [
      result({ caseKey: "a", status: "failed" }),
      result({ caseKey: "b", status: "passed" }),
      result({ caseKey: "c", priority: "P2", status: "passed" }),
      result({ caseKey: "d", priority: "P1", status: "blocked" }),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["a", "b", "d"]);
  });
});

describe("nextRepairStep", () => {
  it("accepts when nothing must-work is failing", () => {
    expect(
      nextRepairStep({
        results: [result({ caseKey: "a" }), result({ caseKey: "b", priority: "P2", status: "failed" })],
        attemptsUsed: 0,
      }),
    ).toEqual({ action: "accept" });
  });

  it("never accepts while a must-work check is blocked", () => {
    const step = nextRepairStep({
      results: [result({ caseKey: "a", status: "blocked" })],
      attemptsUsed: 0,
    });
    expect(step.action).toBe("repair");
  });

  it("repairs and counts the attempt", () => {
    const step = nextRepairStep({
      results: [result({ caseKey: "a", status: "failed", reason: "blank page" })],
      attemptsUsed: 1,
    });
    expect(step).toMatchObject({ action: "repair", attempt: 2 });
  });

  it("stops once the budget is spent", () => {
    const step = nextRepairStep({
      results: [result({ caseKey: "a", status: "failed", reason: "blank page" })],
      attemptsUsed: 3,
    });
    expect(step.action).toBe("stop");
  });

  it("stops when the identical failure comes back", () => {
    const results = [result({ caseKey: "a", status: "failed", reason: "blank page" })];
    const fp = fingerprintDefects(defectsFromResults(results).blocking);
    const step = nextRepairStep({ results, attemptsUsed: 1, previousFingerprint: fp });
    expect(step.action).toBe("stop");
  });

  it("stops with an intervention instead of burning the budget", () => {
    const step = nextRepairStep({
      results: [result({ caseKey: "a", status: "failed", reason: "Missing API key" })],
      attemptsUsed: 0,
    });
    expect(step).toMatchObject({ action: "stop" });
    expect(step.action === "stop" && step.intervention?.kind).toBe("missing_credential");
  });
});
