import { describe, expect, it } from "vitest";
import {
  renderDesignDirectionBlock,
  type DesignDirection,
} from "@/server/design-director.server";

const direction: DesignDirection = {
  vibe: "warm editorial bistro",
  rationale: "a neighbourhood restaurant should feel printed, not templated",
  display_font: "Fraunces",
  body_font: "Karla",
  palette_mood: "ember and bone",
  density: "balanced",
  motion: "expressive",
  fx_recipe: "luxury-brand",
  theme: "warm-brand",
  template: "restaurant",
  design_moves: ["oversized menu numerals", "full-bleed dish photography"],
} as DesignDirection;

describe("design direction prompt scope", () => {
  it("full detail carries the scaffolding instructions", () => {
    const block = renderDesignDirectionBlock(direction, { detail: "full" });
    expect(block).toContain("no `@/components/fx` folder");
    expect(block).toContain("Fraunces");
    expect(block).toContain("oversized menu numerals");
  });

  it("defaults to full detail when no options are passed", () => {
    expect(renderDesignDirectionBlock(direction)).toContain("no `@/components/fx` folder");
  });

  it("compact detail keeps identity but drops the scaffolding", () => {
    const block = renderDesignDirectionBlock(direction, { detail: "compact" });
    expect(block).toContain("Fraunces");
    expect(block).toContain("ember and bone");
    expect(block).toContain("oversized menu numerals");
    expect(block).not.toContain("no `@/components/fx` folder");
    expect(block).not.toContain("fx recipe");
  });

  it("compact detail is substantially smaller than full", () => {
    const full = renderDesignDirectionBlock(direction, { detail: "full" });
    const compact = renderDesignDirectionBlock(direction, { detail: "compact" });
    expect(compact.length).toBeLessThan(full.length / 2);
  });
});
