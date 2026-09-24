import { describe, it, expect } from "vitest";
import { codegenProviderRouting, streamDeltaHasOutput } from "@/server/ai-provider.server";

describe("primary code-generation provider routing", () => {
  it("uses OpenRouter native routing: no allow-list, fallbacks on, bad providers ignored", () => {
    const r = codegenProviderRouting() as Record<string, unknown>;
    expect(r.only).toBeUndefined();
    expect(r.order).toBeUndefined();
    expect(r.allow_fallbacks).toBe(true);
    expect(r.require_parameters).toBe(true);
    expect(r.ignore).toEqual(expect.arrayContaining(["digitalocean", "nextbit"]));
  });
  it("routes away from an upstream that just stalled via ignore", () => {
    const r = codegenProviderRouting(["DeepInfra"]) as { ignore: string[] };
    expect(r.ignore).toContain("deepinfra");
  });
});

describe("stream progress detection", () => {
  it("counts text, reasoning and tool arguments, not empty frames", () => {
    expect(streamDeltaHasOutput({ content: "x" })).toBe(true);
    expect(streamDeltaHasOutput({ reasoning: "t" })).toBe(true);
    expect(streamDeltaHasOutput({ tool_calls: [{ function: { arguments: "{" } }] })).toBe(true);
    expect(streamDeltaHasOutput({ role: "assistant" })).toBe(false);
    expect(streamDeltaHasOutput({ content: "" })).toBe(false);
  });
});
