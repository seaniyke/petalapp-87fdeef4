import { describe, expect, it } from "vitest";
import { extractChangeSet } from "@/server/change-set.server";
import {
  focusFromTurn,
  isTopicChange,
  needsFocus,
  resolveWithFocus,
  type EditFocus,
} from "@/server/edit-focus.server";

const focus: EditFocus = {
  target: "hero",
  paths: ["src/components/Hero.tsx"],
  at: Date.now(),
};

describe("edit focus", () => {
  it("resolves a bare follow-up against the previous turn", () => {
    const cs = extractChangeSet("Make the button white too");
    expect(needsFocus("Make the button white too", cs)).toBe(true);
    const out = resolveWithFocus({ prompt: "Make the button white too", changeSet: cs, focus });
    expect(out.applied).toBe(true);
    expect(out.pinnedPaths).toContain("src/components/Hero.tsx");
    expect(out.block).toMatch(/hero/i);
  });

  it("does not hijack a message that names its own subject", () => {
    const cs = extractChangeSet("Now fix the checkout page");
    expect(isTopicChange("Now fix the checkout page", cs, focus)).toBe(true);
    const out = resolveWithFocus({ prompt: "Now fix the checkout page", changeSet: cs, focus });
    expect(out.applied).toBe(false);
  });

  it("expires stale focus", () => {
    const stale: EditFocus = { ...focus, at: Date.now() - 1000 * 60 * 60 * 24 };
    const cs = extractChangeSet("Make it bigger");
    const out = resolveWithFocus({ prompt: "Make it bigger", changeSet: cs, focus: stale });
    expect(out.applied).toBe(false);
  });

  it("builds the next focus from what changed", () => {
    const cs = extractChangeSet("Make the hero darker");
    const next = focusFromTurn({ changeSet: cs, changedPaths: ["src/components/Hero.tsx"] });
    expect(next?.target).toBe("hero");
    expect(next?.paths).toEqual(["src/components/Hero.tsx"]);
  });

  it("records no focus when nothing changed", () => {
    const cs = extractChangeSet("Make the hero darker");
    expect(focusFromTurn({ changeSet: cs, changedPaths: [] })).toBeNull();
  });
});
