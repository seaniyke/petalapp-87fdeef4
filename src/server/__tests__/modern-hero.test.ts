import { describe, it, expect } from "vitest";
import { renderHeroContractBlock } from "@/server/hero-contract.server";
import { renderBrandContractBlock } from "@/server/brand-contract.server";
import { COMPOSITION_RULES } from "@/server/engine/first-build";
describe("modern hero rules", () => {
  const hero = renderHeroContractBlock({ isInitial: true, webSubtype: "marketing", brief: "a beauty bar" });
  it("bans hero widgets and pills", () => {
    expect(hero).toMatch(/no booking or time-slot widgets/);
    expect(hero).toMatch(/never rounded-full pills/);
    expect(hero).not.toMatch(/Eyebrow badge/);
  });
  it("brand uses typographic wordmark for websites", () => {
    expect(renderBrandContractBlock({ isInitial: true })).toMatch(/typographic wordmark/);
  });
  it("composition bans highlighted words", () => {
    expect(COMPOSITION_RULES).toMatch(/Never colour, italicise or highlight a single word/);
  });
});
