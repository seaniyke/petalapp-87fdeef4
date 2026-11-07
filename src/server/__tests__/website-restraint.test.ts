import { describe, it, expect } from "vitest";
import { COMPOSITION_RULES } from "@/server/engine/first-build";
import { readFileSync } from "node:fs";

describe("website restraint rules", () => {
  it("fixes card anatomy and bans invented specs and unrequested widgets", () => {
    expect(COMPOSITION_RULES).toMatch(/Card anatomy is fixed/);
    expect(COMPOSITION_RULES).toMatch(/Never invent technical specifications/);
    expect(COMPOSITION_RULES).toMatch(/No unrequested tools or widgets/);
    expect(COMPOSITION_RULES).not.toMatch(/metric\/stat bar/);
  });
  it("header must be solid, never blurred", () => {
    expect(COMPOSITION_RULES).toMatch(/never translucent or blurred/);
  });
  it("phone menu panel background cannot be overridden to see-through", () => {
    const kit = readFileSync("src/server/scaffold-kit.ts", "utf8");
    expect(kit).toContain('sideClass[side], className, "bg-background text-foreground")');
  });
});
