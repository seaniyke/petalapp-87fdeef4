import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CALLBACK_ACK_TIMEOUT_MS, PRE_READY_BUDGET_MS } from "@/lib/build-callback-budget";

vi.mock("@/server/ai-provider.server", () => ({
  aiChatCompletions: vi.fn(
    (args: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        args.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  ),
}));

describe("build callback time budget", () => {
  it("leaves at least 5s of the build service's wait for the probe and database writes", () => {
    expect(CALLBACK_ACK_TIMEOUT_MS - PRE_READY_BUDGET_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("matches the wait the build service actually uses for callbacks", () => {
    const src = readFileSync("builder/src/server.ts", "utf8");
    const post = src.slice(src.indexOf("async function postCallback"));
    const ms = Number(/AbortSignal\.timeout\((\d[\d_]*)\)/.exec(post)?.[1]?.replace(/_/g, ""));
    expect(ms).toBe(CALLBACK_ACK_TIMEOUT_MS);
  });

  it("the defect judge returns the deterministic verdict when the deadline passes", async () => {
    const { judgeDefects } = await import("@/server/defect-judge.server");
    const controller = new AbortController();
    const started = Date.now();
    const pending = judgeDefects({
      defects: ["Uncaught TypeError: x is not a function on /"],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const out = await pending;
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(out.judged).toBe(false);
    expect(out.tier).toBe("prior");
  });
});
