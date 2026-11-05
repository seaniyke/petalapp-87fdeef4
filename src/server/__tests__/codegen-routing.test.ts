import { describe, it, expect } from "vitest";
import { streamDeltaHasOutput } from "@/server/ai-provider.server";

describe("stream progress detection", () => {
  it("counts text, reasoning and tool arguments, not empty frames", () => {
    expect(streamDeltaHasOutput({ content: "x" })).toBe(true);
    expect(streamDeltaHasOutput({ reasoning: "t" })).toBe(true);
    expect(streamDeltaHasOutput({ tool_calls: [{ function: { arguments: "{" } }] })).toBe(true);
    expect(streamDeltaHasOutput({ role: "assistant" })).toBe(false);
    expect(streamDeltaHasOutput({ content: "" })).toBe(false);
  });
});
