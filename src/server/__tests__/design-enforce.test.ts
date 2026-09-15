import { describe, expect, it } from "vitest";
import { pickShotSpread } from "@/server/visual-qa.server";
import { lintDesignSystem } from "@/server/design/design-system-lint.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";

const design = {
  typography: { displayFont: "Fraunces", bodyFont: "Inter" },
} as unknown as PicDesignSystem;

describe("design contract lint", () => {
  it("flags raw palette utilities in model-authored files", () => {
    const report = lintDesignSystem(
      [{ path: "src/routes/index.tsx", content: `<div className="bg-blue-600 text-gray-500" />` }],
      design,
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "color/raw-utility")).toBe(true);
  });

  it("ignores scaffold-owned component files when told to skip them", () => {
    const report = lintDesignSystem(
      [{ path: "src/components/ui/button.tsx", content: `<div className="bg-blue-600" />` }],
      design,
      { skip: (p) => p.startsWith("src/components/ui/") },
    );
    expect(report.ok).toBe(true);
  });

  it("accepts semantic tokens", () => {
    const report = lintDesignSystem(
      [{ path: "src/routes/index.tsx", content: `<div className="bg-background text-muted-foreground" />` }],
      design,
    );
    expect(report.errorCount).toBe(0);
  });
});

describe("screenshot spread", () => {
  const shots = [390, 820, 1440].flatMap((width) =>
    ["/", "/dashboard", "/settings", "/pricing"].map((path) => ({
      path,
      width,
      image: `data:image/jpeg;base64,${path}${width}`,
    })),
  );

  it("covers every screen size instead of the first N shots", () => {
    const picked = pickShotSpread(shots, 6);
    expect(picked).toHaveLength(6);
    expect(new Set(picked.map((s) => s.width))).toEqual(new Set([390, 820, 1440]));
  });

  it("returns everything when it already fits", () => {
    expect(pickShotSpread(shots.slice(0, 3), 6)).toHaveLength(3);
  });

  it("drops shots that are not images", () => {
    const picked = pickShotSpread(
      [...shots, { path: "/x", width: 390, image: "not-an-image" }],
      20,
    );
    expect(picked.every((s) => s.image.startsWith("data:image/"))).toBe(true);
  });
});
