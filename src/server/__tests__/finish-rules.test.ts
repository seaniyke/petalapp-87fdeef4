import { describe, it, expect } from "vitest";
import { COMPOSITION_RULES, FINISH_RULES } from "../engine/first-build";

describe("agency finish rules", () => {
  it("reach the first-build composition contract", () => {
    for (const r of FINISH_RULES) expect(COMPOSITION_RULES).toContain(r);
  });
  it("keep the header solid (no blur instruction added)", () => {
    expect(FINISH_RULES.join(" ")).not.toMatch(/backdrop-blur/);
  });
});
