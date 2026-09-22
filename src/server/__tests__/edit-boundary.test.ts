import { describe, expect, it } from "vitest";
import { buildEditBoundary } from "@/server/edit-boundary.server";

const existingPaths = [
  "src/routes/index.tsx",
  "src/routes/signin.tsx",
  "src/components/NavBar.tsx",
];

describe("edit boundary", () => {
  it("keeps a one-thing edit on the page the request named", () => {
    const b = buildEditBoundary({
      scope: "micro",
      targetPaths: ["src/routes/signin.tsx"],
      neighbourPaths: ["src/components/NavBar.tsx"],
      existingPaths,
    });
    expect(b.enforced).toBe(true);
    expect(b.allows("src/routes/signin.tsx")).toBe(true);
    // The landing page was never part of the ask.
    expect(b.allows("src/routes/index.tsx")).toBe(false);
    // Neighbours are context for a micro edit, not writable files.
    expect(b.allows("src/components/NavBar.tsx")).toBe(false);
  });

  it("lets a targeted edit follow an import it has to keep compiling", () => {
    const b = buildEditBoundary({
      scope: "targeted",
      targetPaths: ["src/components/NavBar.tsx"],
      neighbourPaths: ["src/routes/index.tsx"],
      existingPaths,
    });
    expect(b.allows("src/routes/index.tsx")).toBe(true);
    expect(b.allows("src/routes/signin.tsx")).toBe(false);
  });

  it("allows brand-new files", () => {
    const b = buildEditBoundary({
      scope: "micro",
      targetPaths: ["src/routes/signin.tsx"],
      existingPaths,
    });
    expect(b.allows("src/components/BackLink.tsx")).toBe(true);
  });

  it("stays open for structural work, initial builds and unresolved targets", () => {
    expect(
      buildEditBoundary({ scope: "structural", targetPaths: ["src/routes/index.tsx"], existingPaths })
        .enforced,
    ).toBe(false);
    expect(buildEditBoundary({ scope: "micro", targetPaths: [], existingPaths }).enforced).toBe(false);
    expect(
      buildEditBoundary({
        scope: "micro",
        targetPaths: ["a.tsx"],
        existingPaths,
        disabled: true,
      }).enforced,
    ).toBe(false);
  });

  it("stands down when a targeted ask resolved to most of the app", () => {
    const many = Array.from({ length: 9 }, (_, i) => `src/components/C${i}.tsx`);
    expect(buildEditBoundary({ scope: "targeted", targetPaths: many, existingPaths: many }).enforced).toBe(
      false,
    );
  });
});
