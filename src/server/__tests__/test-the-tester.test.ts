/**
 * The most important test in the Test Lab: does the testing actually work?
 *
 * A deliberately broken sample app (one backend fault, one visual fault) is
 * planned, driven, judged, diagnosed, repaired and retested end to end. The
 * assertions are about behaviour, not wiring: the faults must be *caught*, the
 * repair must be the smallest one, previously passing must-work checks must be
 * re-run, and only the repaired app may be called ready.
 */
import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "../readiness.server";
import { buildTestPlan, selectCases } from "../test-plan.server";
import { defectsFromResults, nextRepairStep, retestSelection } from "../test-repair.server";
import { judgeCase, runStatusFor, tallyResults } from "../test-results.server";
import {
  SAMPLE_PROJECT_ID,
  defectiveAppFiles,
  defectiveVerifyPlan,
  repairedAppFiles,
  simulateBrowse,
} from "./fixtures/defective-app";

const plan = (files = defectiveAppFiles) =>
  buildTestPlan({ projectId: SAMPLE_PROJECT_ID, files, verify: defectiveVerifyPlan });

const runAll = (repaired: boolean) => {
  const p = plan(repaired ? repairedAppFiles : defectiveAppFiles);
  const { run } = selectCases(p, "full");
  return { plan: p, cases: run, results: run.map((c) => judgeCase(c, simulateBrowse(c, repaired))) };
};

describe("the sample app is planned properly", () => {
  it("covers the pages it actually built, must-work checks first", () => {
    const p = plan();
    const routes = p.cases.flatMap((c) =>
      c.actions.filter((a) => a.action === "goto").map((a) => (a as { path: string }).path),
    );
    expect(routes).toContain("/");
    expect(routes).toContain("/notes");
    expect(routes).toContain("/dashboard");
    expect(p.cases.some((c) => c.priority === "P0")).toBe(true);
    expect(p.auth?.protectedRoutes).toContain("/dashboard");
  });
});

describe("the broken app is caught, not passed", () => {
  const { results } = runAll(false);

  it("catches the backend fault with its evidence", () => {
    const notes = results.find((r) => r.url?.endsWith("/notes"));
    expect(notes?.status).toBe("failed");
    expect(notes?.failedRequests.join(" ")).toContain("note_entries");
    expect(notes?.pageErrors.length).toBeGreaterThan(0);
  });

  it("catches the visual fault — the page loads but the heading is not there", () => {
    const dash = results.filter((r) => r.url?.endsWith("/dashboard"));
    expect(dash.length).toBeGreaterThan(0);
    const text = dash.map((r) => r.actual ?? "").join(" ");
    expect(text).not.toContain("Your dashboard");
    expect(dash.some((r) => r.images.length > 0 || r.evidence.screenshots.length >= 0)).toBe(true);
  });

  it("never reports the run as passing", () => {
    const totals = tallyResults(results);
    expect(totals.failed).toBeGreaterThan(0);
    expect(runStatusFor(totals)).toBe("failed");
  });

  it("is not called ready", () => {
    const readiness = evaluateReadiness({ shipped: true, blockingDefects: [], results });
    expect(readiness.accepted).toBe(false);
    expect(readiness.verdict).not.toBe("ready");
  });
});

describe("diagnosis, repair and retest", () => {
  const first = runAll(false);

  it("phrases the failures as fixable defects with what was seen", () => {
    const { blocking, advisory } = defectsFromResults(first.results);
    const all = [...blocking, ...advisory].join("\n");
    expect(all).toContain("/notes");
    expect(all.toLowerCase()).toContain("note_entries");
  });

  it("decides to repair rather than accept or give up", () => {
    const decision = nextRepairStep({ results: first.results, attemptsUsed: 0 });
    expect(decision.action).toBe("repair");
  });

  it("re-runs what failed plus the must-work checks that were passing", () => {
    const retest = retestSelection(first.cases, first.results);
    const keys = retest.map((c) => c.id);
    const failedKeys = first.results.filter((r) => r.status === "failed").map((r) => r.caseKey);
    for (const k of failedKeys) expect(keys).toContain(k);
    const passingP0 = first.results.filter((r) => r.status === "passed" && r.priority === "P0");
    for (const r of passingP0) expect(keys).toContain(r.caseKey);
  });

  it("stops instead of looping when the same failure comes back unchanged", () => {
    const { blocking } = defectsFromResults(first.results);
    const again = nextRepairStep({
      results: first.results,
      attemptsUsed: 1,
      previousFingerprint: (
        nextRepairStep({ results: first.results, attemptsUsed: 0 }) as {
          blocking: string[];
        }
      ).blocking.length
        ? fingerprint(blocking)
        : null,
    });
    expect(again.action).toBe("stop");
  });
});

describe("the repaired app passes and only then is called ready", () => {
  const { results } = runAll(true);

  it("every check passes", () => {
    const totals = tallyResults(results);
    expect(totals.failed).toBe(0);
    expect(totals.p0Blocked).toBe(0);
    expect(runStatusFor(totals)).toBe("passed");
  });

  it("the fix is the smallest one — only the two faulty files changed", () => {
    const changed = repairedAppFiles
      .filter((f) => defectiveAppFiles.find((d) => d.path === f.path)?.content !== f.content)
      .map((f) => f.path)
      .sort();
    expect(changed).toEqual(["src/pages/Dashboard.tsx", "src/pages/Notes.tsx"]);
  });

  it("is accepted as ready", () => {
    const readiness = evaluateReadiness({ shipped: true, blockingDefects: [], results });
    expect(readiness.verdict).toBe("ready");
    expect(readiness.accepted).toBe(true);
  });

  it("nothing accepts a build that never got tested", () => {
    const readiness = evaluateReadiness({ shipped: true, blockingDefects: [], results: [] });
    expect(readiness.accepted).toBe(false);
  });
});

function fingerprint(defects: string[]): string {
  return [...defects]
    .map((d) => d.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim())
    .sort()
    .join("|")
    .slice(0, 800);
}
