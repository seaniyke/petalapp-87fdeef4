import { describe, it, expect } from "vitest";
import { trackCostWrite, flushCostWrites } from "@/server/ai-provider.server";

describe("settlement waits for the last cost write", () => {
  it("flush resolves only after late writes (including ones added while flushing)", async () => {
    const landed: string[] = [];
    void trackCostWrite(new Promise<void>((r) => setTimeout(() => { landed.push("a"); void trackCostWrite(new Promise<void>((r2) => setTimeout(() => { landed.push("final-step"); r2(); }, 30))); r(); }, 20)));
    const res = await flushCostWrites(2000);
    expect(res.timedOut).toBe(false);
    expect(landed).toEqual(["a", "final-step"]);
  });
  it("a failed write never blocks settlement", async () => {
    void trackCostWrite(Promise.reject(new Error("x"))).catch(() => {});
    expect((await flushCostWrites(500)).timedOut).toBe(false);
  });
  it("bounded wait", async () => {
    void trackCostWrite(new Promise(() => {}));
    expect((await flushCostWrites(50)).timedOut).toBe(true);
  });
});
