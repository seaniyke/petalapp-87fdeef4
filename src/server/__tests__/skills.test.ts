import { describe, expect, it } from "vitest";
import { renderSkillsForTurn, selectSkills, SKILLS } from "@/server/skills";

const base = {
  scope: "targeted" as const,
  dimensions: [] as string[],
  text: "",
  isInitial: false,
  isCrossCutting: false,
};

describe("focused expertise", () => {
  it("always brings the safety rulebook to an edit", () => {
    const ids = selectSkills({ ...base, text: "change the button label" }).map((s) => s.id);
    expect(ids).toContain("redesign-safety");
  });

  it("keeps a one-thing ask light", () => {
    const picked = selectSkills({
      ...base,
      scope: "micro",
      text: "make the hero headline bigger and a different colour",
    });
    expect(picked.length).toBeLessThanOrEqual(2);
    const rendered = renderSkillsForTurn({
      ...base,
      scope: "micro",
      text: "make the headline bigger",
    });
    // Canonical redesign-safety Markdown only — no copy/motion/section manuals.
    expect(rendered.ids).toEqual(["redesign-safety", "typography-color"]);
    expect(rendered.text).not.toContain("Choosing section architectures");
  });

  it("brings picture expertise when the ask is about pictures", () => {
    const ids = selectSkills({ ...base, text: "replace the broken image in how it works" }).map(
      (s) => s.id,
    );
    expect(ids).toContain("imagery");
  });

  it("brings form expertise when the ask touches sign-up", () => {
    const ids = selectSkills({ ...base, text: "add a back link to the sign in page" }).map((s) => s.id);
    expect(ids).toContain("forms-and-data");
  });

  it("gives a first build composition and writing expertise", () => {
    const ids = selectSkills({ ...base, isInitial: true, text: "build a bakery site" }).map((s) => s.id);
    expect(ids).toContain("page-composition");
    expect(ids.length).toBeLessThanOrEqual(5);
  });

  it("never loads everything at once", () => {
    const picked = selectSkills({
      ...base,
      isInitial: true,
      isCrossCutting: true,
      dimensions: ["visual", "copy", "data", "motion"],
      text: "redesign everything with animation, images, forms and seo",
    });
    expect(picked.length).toBeLessThan(SKILLS.length);
  });

  it("renders nothing when no skill applies", () => {
    expect(renderSkillsForTurn({ ...base, isInitial: false, text: "" }).text).toContain(
      "Changing an app that already works",
    );
  });
});
