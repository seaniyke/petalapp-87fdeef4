import { describe, it, expect } from "vitest";
import { pagesProjectName, pagesUrlFor } from "@/server/build-reconcile.server";

/**
 * The reconciler can only find a finished build's deployment if it derives the
 * exact hostname the builder used. These expectations mirror `projectNameFor()`
 * in builder/src/build.ts — if that changes, this must change with it.
 */
describe("pages hostname derivation", () => {
  it("uses the first 12 hex chars of the project id", () => {
    expect(pagesProjectName("ace8f15b-fd43-4477-be85-3dda44d574c3")).toBe("petal-ace8f15bfd43");
  });

  it("lowercases and strips hyphens", () => {
    expect(pagesProjectName("ACE8F15B-FD43-4477-BE85-3DDA44D574C3")).toBe("petal-ace8f15bfd43");
  });

  it("builds the stable pages.dev url", () => {
    expect(pagesUrlFor("ace8f15b-fd43-4477-be85-3dda44d574c3")).toBe(
      "https://petal-ace8f15bfd43.pages.dev",
    );
  });
});
