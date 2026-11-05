import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AI_GATEWAY_CHAT_URL } from "@/lib/ai-model-config";
import { isEmptyAllowList } from "@/server/engine/provider-policy";
import { runWithTurnContext, providersExhaustedForTurn, markUpstreamFailed } from "@/server/turn-context.server";

describe("gateway routing for code generation", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<Record<string, unknown>>;
  let status = 200;

  beforeEach(() => {
    calls = [];
    status = 200;
    process.env.LOVABLE_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      if (String(url) === AI_GATEWAY_CHAT_URL) calls.push(JSON.parse((init as { body: string }).body));
      return new Response(JSON.stringify(status === 200 ? { choices: [] } : { error: { message: "No endpoints found" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const call = async () => {
    const { aiChatCompletions } = await import("@/server/ai-provider.server");
    return aiChatCompletions({ feature: "generate", codeOutput: true, body: { messages: [{ role: "user", content: "x" }] } });
  };

  it("normal generation: one request, no provider block (gateway owns failover)", async () => {
    await runWithTurnContext({ turnId: "a" }, async () => {
      const r = await call();
      expect(r.ok).toBe(true);
    });
    expect(calls.length).toBe(1);
    expect(calls[0].provider).toBeUndefined();
  }, 30_000);

  it("after provider failures, the next call still goes straight to the gateway", async () => {
    await runWithTurnContext({ turnId: "b" }, async () => {
      markUpstreamFailed("DeepInfra");
      markUpstreamFailed("Azure");
      const r = await call();
      expect(r.ok).toBe(true);
    });
    expect(calls.length).toBe(1);
    expect(calls[0].provider).toBeUndefined();
  }, 30_000);

  it("no eligible provider (gateway 404): terminal, never re-sent", async () => {
    status = 404;
    let exhausted = false;
    await runWithTurnContext({ turnId: "c" }, async () => {
      const r = await call();
      expect(r.ok).toBe(false);
      exhausted = providersExhaustedForTurn();
    });
    expect(calls.length).toBe(1);
    expect(exhausted).toBe(true);
  }, 30_000);

  it("an empty allow-list is recognised and yields a typed failure without sending", async () => {
    expect(isEmptyAllowList({ only: [] })).toBe(true);
    expect(isEmptyAllowList({ ignore: ["x"] })).toBe(false);
    const { providersExhaustedResponse } = await import("@/server/ai-provider.server");
    const r = providersExhaustedResponse();
    expect(r.status).toBe(503);
    expect((await r.json()).error.type).toBe("providers_exhausted");
    expect(calls.length).toBe(0);
  });
});
