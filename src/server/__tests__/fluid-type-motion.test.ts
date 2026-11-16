import { describe, it, expect } from "vitest";
import { STYLES_CSS } from "../scaffold-kit";

describe("fluid typography + micro-motion in the starter stylesheet", () => {
  it("defines fluid hero size scaling between 2.75rem and 6.5rem", () => {
    expect(STYLES_CSS).toContain("--text-hero: clamp(2.75rem,");
    expect(STYLES_CSS).toMatch(/--text-hero: clamp\(2\.75rem, [^)]+, 6\.5rem\)/);
  });
  it("ships the CSS motion utilities", () => {
    for (const u of ["hover-lift", "hover-zoom", "press", "surface-grain", "ambient-glow"]) expect(STYLES_CSS).toContain(`@utility ${u} {`);
  });
  it("respects reduced motion", () => {
    expect(STYLES_CSS).toContain("prefers-reduced-motion: reduce");
  });
});
