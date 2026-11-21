import { describe, it, expect } from "vitest";
import { resolvePackageForIntent } from "../design-systems/authority";

const salon = "Website for a luxury wig installation salon in Lagos.";

describe("style picker follows the described look", () => {
  it("a near-black / Vercel brief gets the dark look", () => {
    expect(resolvePackageForIntent(`${salon} Vercel-level polish on a near-black canvas.`)?.pkg.meta.slug).toBe("obsidian");
    expect(resolvePackageForIntent(`${salon} All-black website.`)?.pkg.meta.slug).toBe("obsidian");
  });
  it("beauty businesses never land on the square Swiss look by chance", () => {
    for (let i = 0; i < 60; i++) {
      expect(resolvePackageForIntent(salon, { seed: `project-${i}` })?.pkg.meta.slug).not.toBe("monolith");
    }
  });
});
