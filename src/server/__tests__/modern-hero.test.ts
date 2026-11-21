import { describe, it, expect } from "vitest";
import { renderHeroContractBlock } from "@/server/hero-contract.server";
import { renderBrandContractBlock } from "@/server/brand-contract.server";
import { COMPOSITION_RULES } from "@/server/engine/first-build";
import { classifyAppShape, renderShapeBlock } from "@/lib/app-shape-classifier";
describe("modern hero rules", () => {
  const hero = renderHeroContractBlock({ isInitial: true, webSubtype: "marketing", brief: "a beauty bar" });
  it("bans hero widgets and pills", () => {
    expect(hero).toMatch(/no booking or time-slot widgets/);
    expect(hero).toMatch(/variant=\"glass\"/);
    expect(hero).not.toMatch(/Eyebrow badge/);
  });
  it("brand uses typographic wordmark for websites", () => {
    expect(renderBrandContractBlock({ isInitial: true })).toMatch(/typographic wordmark/);
  });
  it("composition bans highlighted words", () => {
    expect(COMPOSITION_RULES).toMatch(/Never colour, italicise or highlight a single word/);
  });
});

describe("hero freedom (Custard brief, 16 Nov)", () => {
  const hero = renderHeroContractBlock({ isInitial: true, webSubtype: "marketing", brief: "a 24-hour restaurant inside a hotel in Enugu" });
  it("forbids address, location and hours in the hero label", () => {
    expect(hero).toMatch(/NEVER the address, location, opening hours or rating/);
  });
  it("allows a type-led hero without a picture", () => {
    expect(hero).toMatch(/type-led hero with no picture is fine/);
  });
});

describe("no fixed SaaS hero formula", () => {
  it("the landing-page guidance no longer demands a label badge, trust row or two buttons", () => {
    const block = renderShapeBlock(classifyAppShape("an online shop for natural hair products with checkout"));
    expect(block).toMatch(/Marketing surface:/);
    expect(block).not.toMatch(/eyebrow badge/);
    expect(block).not.toMatch(/trust row \+/);
    expect(block).not.toMatch(/build ALL seven/);
  });
});
