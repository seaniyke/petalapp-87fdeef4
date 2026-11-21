import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT_INITIAL } from "@/server/generate.server";
import { renderDesignTasteBlock } from "@/server/design-taste.server";

const read = (p: string) => readFileSync(p, "utf8");

describe("design rules give permission instead of bans", () => {
  it("no prompt bans glass, rounded cards or springs", () => {
    const manual = read("src/server/agent-knowledge/system.md");
    expect(manual).not.toMatch(/glassmorphism/i);
    expect(manual).not.toMatch(/Rounded-everything/);
    expect(manual).not.toMatch(/bounce springs/);
  });
  it("layout is not forced into Card/Container", () => {
    expect(SYSTEM_PROMPT_INITIAL).not.toMatch(/ANTI-PATTERNS/);
    expect(SYSTEM_PROMPT_INITIAL).not.toMatch(/A "feature card" is <Card>, not a custom div/);
    expect(SYSTEM_PROMPT_INITIAL).toMatch(/Layout and visual containers are yours to design/);
  });
  it("depth is never discouraged by the redesign skill", () => {
    expect(read("src/server/agent-knowledge/skills/redesign-safety/SKILL.md")).not.toMatch(/Atmosphere effects/);
  });
  it("taste block keeps package ownership of colour and has no refused-cliché list", () => {
    const { text } = renderDesignTasteBlock("a wig salon", { packageOwnsVisuals: true });
    expect(text).not.toMatch(/Refused clichés/);
    expect(text).toMatch(/SELECTED DESIGN SYSTEM/);
  });
});
