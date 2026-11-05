import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  coerceToConfiguredModel,
  defaultTextModel,
  defaultVisionModel,
  AI_GATEWAY_CHAT_URL,
} from "@/lib/ai-model-config";

describe("central AI model config", () => {
  it("coerces any non-configured slug to the configured gateway model", () => {
    for (const legacy of [
      "google/gemini-2.5-flash-lite",
      "google/gemini-3-flash-preview",
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-5",
      "deepseek/deepseek-v4-flash",
      "meta-llama/llama-3.3-70b-versatile",
      null,
      undefined,
      "",
    ]) {
      expect(coerceToConfiguredModel(legacy)).toBe(defaultTextModel());
    }
  });

  it("never resolves to openrouter/auto", () => {
    expect(coerceToConfiguredModel("openrouter/auto")).toBe(defaultTextModel());
    expect(defaultTextModel()).not.toContain("auto");
  });

  it("upgrades to the vision model only when images are present", () => {
    expect(coerceToConfiguredModel("openai/gpt-4o", { vision: true })).toBe(defaultVisionModel());
    expect(coerceToConfiguredModel(defaultTextModel(), { vision: true })).toBe(
      defaultVisionModel(),
    );
    expect(coerceToConfiguredModel(defaultTextModel())).toBe(defaultTextModel());
  }, 30_000);
});

describe("aiChatCompletions wire contract", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }>;

  beforeEach(() => {
    calls = [];
    process.env.LOVABLE_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      const req = init as { body: string; headers: Record<string, string> };
      calls.push({
        url: String(url),
        body: JSON.parse(req.body),
        headers: req.headers,
      });
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const gwCalls = () => calls.filter((c) => c.url === AI_GATEWAY_CHAT_URL);

  it("sends every call to the Lovable AI Gateway with the configured model", async () => {
    const { aiChatCompletions } = await import("@/server/ai-provider.server");
    await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    // Exactly one model request — no multi-provider fan-out.
    expect(gwCalls().length).toBe(1);
    expect(gwCalls()[0].body.model).toBe(defaultTextModel());
    expect(gwCalls()[0].headers.Authorization).toBe("Bearer test-key");
    // No other AI gateway is contacted.
    expect(calls.some((c) => c.url.includes("openrouter.ai"))).toBe(false);
  }, 30_000);

  it("requests token usage on streamed calls", async () => {
    const { aiChatCompletions } = await import("@/server/ai-provider.server");
    await aiChatCompletions({
      feature: "discuss",
      body: { model: "openai/gpt-4o", stream: true, messages: [] },
    });
    expect(gwCalls()[0].body.stream_options).toEqual({ include_usage: true });
  }, 30_000);

  it("sends no upstream provider-routing block — the gateway owns failover", async () => {
    const { aiChatCompletions } = await import("@/server/ai-provider.server");
    await aiChatCompletions({
      feature: "generate",
      codeOutput: true,
      body: { messages: [{ role: "user", content: "x" }] },
    });
    expect(gwCalls()[0].body.provider).toBeUndefined();
  }, 30_000);

  it("uses the vision model when the request carries an image part", async () => {
    const { aiChatCompletions } = await import("@/server/ai-provider.server");
    await aiChatCompletions({
      feature: "design",
      body: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              { type: "image_url", image_url: { url: "https://x/y.png" } },
            ],
          },
        ],
      },
    });
    expect(gwCalls()[0].body.model).toBe(defaultVisionModel());
  }, 30_000);
});
