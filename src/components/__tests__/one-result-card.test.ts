/**
 * One card per finished turn.
 *
 * A completed build used to stack three cards in the thread: the cost
 * summary, the completion status and the "what next" suggestions. This test
 * locks in the single-card rule by checking the thread never renders the
 * retired cards, and that the one result card is the only completion surface.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("one result card per completed turn", () => {
  it("the retired next-steps card is gone", () => {
    expect(existsSync(join(root, "src/components/NextStepsCard.tsx"))).toBe(false);
  });

  it("the builder thread renders no completion card of its own", () => {
    const builder = read("src/routes/builder.tsx");
    expect(builder).not.toContain("<NextStepsCard");
    expect(builder).not.toContain("<BuildCostSummary");
    expect(builder).not.toContain("<CompletionStatusCard");
  });

  it("the activity card shows exactly one result surface when complete", () => {
    const card = read("src/components/BuildActivityCard.tsx");
    const results = card.match(/<BuildResultCard/g) ?? [];
    expect(results).toHaveLength(1);
    expect(card).not.toContain("<BuildCostSummary");
  });
});
