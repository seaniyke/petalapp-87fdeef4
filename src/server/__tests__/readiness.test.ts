import { describe, expect, it } from "vitest";
import { evaluateReadiness, readinessHeadline } from "@/server/readiness.server";
import type { CaseResult } from "@/server/test-results.server";

function result(over: Partial<CaseResult> & Pick<CaseResult, "caseKey">): CaseResult {
  return {
    title: "App opens",
    priority: "P0",
    category: "load",
    status: "passed",
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    images: [],
    evidence: {} as CaseResult["evidence"],
    ...over,
  };
}

describe("evaluateReadiness", () => {
  it("is ready when every must-work check passed", () => {
    const r = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      results: [
        result({ caseKey: "a", title: "App opens" }),
        result({ caseKey: "b", title: "Sign in works" }),
        result({ caseKey: "c", priority: "P2", status: "failed", title: "Footer link" }),
      ],
    });
    expect(r.verdict).toBe("ready");
    expect(r.accepted).toBe(true);
    expect(r.checked).toEqual(["App opens", "Sign in works"]);
  });

  it("is not ready when a must-work check failed", () => {
    const r = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      budgetSpent: true,
      results: [
        result({ caseKey: "a" }),
        result({
          caseKey: "b",
          title: "Sign in works",
          status: "failed",
          reason: "stayed on the sign-in page",
          url: "/auth",
        }),
      ],
    });
    expect(r.verdict).toBe("not_ready");
    expect(r.accepted).toBe(false);
    expect(r.failed).toEqual(["Sign in works"]);
    expect(r.reasons.join(" ")).toContain("/auth");
  });

  it("never passes a must-work check that could not be run", () => {
    const r = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      results: [
        result({ caseKey: "a" }),
        result({ caseKey: "b", title: "Booking completes", status: "blocked" }),
      ],
    });
    expect(r.verdict).toBe("unverified");
    expect(r.accepted).toBe(false);
    expect(r.unverified).toEqual(["Booking completes"]);
  });

  it("treats a skipped must-work check as unverified, not passed", () => {
    const r = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      results: [result({ caseKey: "a", status: "skipped", title: "App opens" })],
    });
    expect(r.verdict).toBe("unverified");
  });

  it("returns unverified when something unfixable stopped the checks", () => {
    const r = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      results: [result({ caseKey: "a" })],
      intervention: {
        kind: "missing_credential",
        message: "A key for one of the outside services is missing.",
        caseKey: "a",
      },
    });
    expect(r.verdict).toBe("unverified");
    expect(r.reasons[0]).toContain("key");
  });

  it("falls back to today's decision when no checks ran", () => {
    expect(evaluateReadiness({ shipped: true, blockingDefects: [] })).toMatchObject({
      verdict: "ready",
      accepted: true,
    });
    expect(
      evaluateReadiness({ shipped: true, blockingDefects: ["blank page on /"] }),
    ).toMatchObject({ verdict: "not_ready", accepted: false });
    expect(evaluateReadiness({ shipped: false, blockingDefects: [] })).toMatchObject({
      verdict: "not_ready",
      accepted: false,
    });
  });

  it("gives a plain headline per verdict", () => {
    const ready = evaluateReadiness({ shipped: true, blockingDefects: [] });
    expect(readinessHeadline(ready)).toContain("ready");
    const bad = evaluateReadiness({ shipped: false, blockingDefects: [] });
    expect(readinessHeadline(bad)).toContain("not ready");
  });
});
