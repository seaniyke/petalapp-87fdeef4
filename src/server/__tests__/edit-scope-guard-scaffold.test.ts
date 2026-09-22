import { describe, it, expect } from "vitest";
import { analyzeEditScope } from "../edit-scope-guard.server";
import { isScaffoldOwnedPath } from "../scaffold-ownership.server";

const big = (n: number) => "x".repeat(n);

describe("scaffold ownership is extension-insensitive", () => {
  it("treats use-axe.tsx the same as use-axe.ts", () => {
    expect(isScaffoldOwnedPath("src/hooks/use-axe.ts")).toBe(true);
    expect(isScaffoldOwnedPath("src/hooks/use-axe.tsx")).toBe(true);
  });

  it("does not claim ordinary app files", () => {
    expect(isScaffoldOwnedPath("src/components/Hero.tsx")).toBe(false);
  });
});

describe("scope guard ignores scaffold-owned files", () => {
  it("does not flag a shrink in a Kimble-owned kit file", () => {
    const report = analyzeEditScope(
      [{ path: "src/hooks/use-axe.tsx", content: big(4000) }],
      [{ path: "src/hooks/use-axe.tsx", content: big(300) }],
      "add realistic images to the landing page",
    );
    expect(report.shrunkPaths).toEqual([]);
    expect(report.flagged).toBe(false);
  });

  it("still flags a shrink in real app code", () => {
    const report = analyzeEditScope(
      [{ path: "src/components/Hero.tsx", content: big(4000) }],
      [{ path: "src/components/Hero.tsx", content: big(300) }],
      "change the heading colour",
    );
    expect(report.shrunkPaths).toEqual(["src/components/Hero.tsx"]);
    expect(report.flagged).toBe(true);
  });
});
