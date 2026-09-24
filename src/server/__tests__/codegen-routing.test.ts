import { describe, it, expect } from "vitest";
import { codegenProviderRouting, streamDeltaHasOutput } from "@/server/ai-provider.server";

describe("primary code-generation provider routing", () => {
  it("prefers OpenInference (DeepInfra not primary), keeps a fallback, never DigitalOcean/NextBit", () => {
    const r = codegenProviderRouting() as { order: string[]; ignore: string[]; allow_fallbacks: boolean };
    expect(r.order[0]).toBe("openinference");
    expect(r.order.length).toBeGreaterThan(1);
    expect(r.allow_fallbacks).toBe(true);
    expect(r.ignore).toEqual(expect.arrayContaining(["digitalocean", "nextbit"]));
    expect(r.order).not.toContain("digitalocean");
  });
  it("routes away from an upstream that just stalled", () => {
    const r = codegenProviderRouting(["DeepInfra"]) as { order: string[]; ignore: string[] };
    expect(r.order).not.toContain("deepinfra");
    expect(r.ignore).toContain("deepinfra");
    expect(r.order.length).toBeGreaterThan(0);
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
