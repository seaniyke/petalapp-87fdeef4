import { describe, it, expect } from "vitest";
import { classifyTaskDifficulty, modelForDifficulty, defaultTextModel } from "@/lib/ai-model-config";
import { TURN_REPAIR_COST_CEILING_USD, TURN_REPAIR_COST_WARN_USD } from "@/server/turn-cost-ceiling.server";

describe("cost routing", () => {
  it("a long targeted edit stays on the fast model", () => {
    const d = classifyTaskDifficulty({ scope: "targeted", promptChars: 4000 });
    expect(d).toBe("standard");
    expect(modelForDifficulty(d)).toBe(defaultTextModel());
  });
  it("site-wide work still escalates", () => {
    expect(classifyTaskDifficulty({ crossCutting: true, promptChars: 50 })).toBe("hard");
  });
  it("repair spend per turn is capped at $1", () => {
    expect(TURN_REPAIR_COST_CEILING_USD).toBe(1);
    expect(TURN_REPAIR_COST_WARN_USD).toBe(0.6);
  });
});
