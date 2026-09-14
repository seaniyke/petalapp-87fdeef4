import { describe, expect, it } from "vitest";
import { runHeadline } from "@/lib/test-lab.functions";

const totals = (p: number, f: number, b: number, s = 0) => ({
  passed: p,
  failed: f,
  blocked: b,
  skipped: s,
});

describe("runHeadline", () => {
  it("says work is in progress while running", () => {
    expect(runHeadline("running", totals(1, 0, 0))).toContain("checking your app right now");
  });

  it("leads with failures", () => {
    expect(runHeadline("failed", totals(4, 2, 0))).toContain("2 of 6 checks did not pass");
  });

  it("never claims a blocked check works", () => {
    const line = runHeadline("blocked", totals(3, 0, 1));
    expect(line).toContain("could not finish 1 check");
    expect(line).not.toContain("All");
  });

  it("confirms a clean run", () => {
    expect(runHeadline("passed", totals(5, 0, 0, 2))).toBe("All 5 checks passed on your live app.");
  });

  it("is honest when nothing ran", () => {
    expect(runHeadline("passed", totals(0, 0, 0))).toBe("No checks were run for this build.");
  });
});
