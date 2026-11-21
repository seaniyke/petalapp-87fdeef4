import { describe, it, expect } from "vitest";
import { STYLES_CSS } from "../scaffold-kit";
import { KIT_MOTION_FILES } from "../scaffold-kit-motion";
import { renderDesignTasteBlock } from "../design-taste.server";
import { renderLayoutArchetypeBlock } from "../design/layout-archetypes";

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
  it("ships depth surfaces", () => {
    for (const u of ["glass", "edge-light", "mesh-backdrop"]) expect(STYLES_CSS).toContain(`@utility ${u} {`);
  });
  it("ships physics motion primitives", () => {
    const paths = KIT_MOTION_FILES.map((f) => f.path);
    for (const n of ["spring", "scroll-scale", "spotlight", "marquee"]) expect(paths).toContain(`src/components/motion/${n}.tsx`);
  });
  it("no longer bans glass, glow or motion outright", () => {
    const t = renderDesignTasteBlock("a bakery").text;
    expect(t).not.toContain("No gradient blobs, radial glows, mesh washes, glassmorphism");
    expect(t).not.toContain("No marquees, tickers");
  });
  it("lets the person's words override the layout archetype", () => {
    expect(renderLayoutArchetypeBlock("bento-showcase")).toContain("the person's own words win");
  });
});

