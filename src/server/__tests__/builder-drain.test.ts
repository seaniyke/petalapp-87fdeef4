import { describe, it, expect, vi } from "vitest";
import { sendWithBuilderRetry, retryAfterMs } from "@/server/builder-retry";
import { dispatchAgentJob, buildAgentJobPayload } from "@/server/durable-agent.server";
import { BUILD_DISPATCH_RETRY_DELAYS_MS, BUILD_DISPATCH_MAX_TOTAL_MS } from "@/server/builder.server";
import { DrainGate, AcceptedJobs, waitUntilIdle } from "../../../builder/src/drain";

const ENV = { USE_DURABLE_AGENT: "1", BUILDER_URL: "https://builder.test", BUILDER_SHARED_SECRET: "s3cret" };
const TURN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/** Virtual clock: sleeping advances time instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), elapsed: () => t };
}
const draining = () =>
  new Response(JSON.stringify({ error: "Builder is updating, please retry", draining: true }), {
    status: 503,
    headers: { "Retry-After": "5" },
  });

describe("builder drain gate", () => {
  it("drains only while a fresh drain file exists", () => {
    let mtime: number | null = null;
    const stat = (_: string) => {
      if (mtime === null) throw new Error("ENOENT");
      return { mtimeMs: mtime };
    };
    let now = 1_000_000;
    const gate = new DrainGate("/x", 10 * 60_000, stat, () => now);
    expect(gate.isDraining()).toBe(false);
    mtime = now;
    expect(gate.isDraining()).toBe(true);
    now += 10 * 60_000; // a deploy killed half-way can't block jobs past 10 minutes
    expect(gate.isDraining()).toBe(false);
  });

  it("refuses new jobs for good once shutting down", () => {
    const gate = new DrainGate("/x", 1, () => {
      throw new Error("ENOENT");
    });
    gate.beginShutdown();
    expect(gate.isDraining()).toBe(true);
  });

  it("acknowledges a re-sent job id instead of starting it twice", () => {
    const jobs = new AcceptedJobs();
    expect(jobs.begin("b1")).toBe(true);
    expect(jobs.begin("b1")).toBe(false);
    jobs.end("b1");
    expect(jobs.begin("b1")).toBe(true); // a later retry of a finished build runs again
  });

  it("shutdown waits for running work, then gives up at the grace limit", async () => {
    const c = clock();
    let busy = 2;
    const idle = waitUntilIdle(() => busy, 25_000, 250, async (ms) => {
      await c.sleep(ms);
      if (c.elapsed() >= 3_000) busy = 0;
    }, c.now);
    expect(await idle).toBe(true);
    expect(c.elapsed()).toBe(3_000);
    const c2 = clock();
    expect(await waitUntilIdle(() => 1, 25_000, 250, c2.sleep, c2.now)).toBe(false);
    expect(c2.elapsed()).toBe(25_000);
  });
});

describe("app side: waiting out a deploy", () => {
  it("honours the builder's Retry-After", () => {
    expect(retryAfterMs(draining())).toBe(5_000);
    expect(retryAfterMs(new Response("", { headers: { "Retry-After": "999" } }))).toBe(30_000);
  });

  it("a new generation sent during a 60-second drain is accepted, not failed", async () => {
    const c = clock();
    const fetcher = vi.fn(async () => (c.elapsed() < 60_000 ? draining() : new Response("{}", { status: 202 }))) as unknown as typeof fetch;
    const job = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    const out = await dispatchAgentJob(job, fetcher, ENV, { sleep: c.sleep, now: c.now });
    expect(out).toEqual({ ok: true });
    expect(c.elapsed()).toBeGreaterThanOrEqual(60_000);
  });

  it("a generation sent during the container swap (connection refused) is accepted", async () => {
    const c = clock();
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls <= 2) throw new Error("ECONNREFUSED");
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const job = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    expect(await dispatchAgentJob(job, fetcher, ENV, { sleep: c.sleep, now: c.now })).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("a real refusal is not retried", async () => {
    const c = clock();
    const fetcher = vi.fn(async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    const job = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    expect(await dispatchAgentJob(job, fetcher, ENV, { sleep: c.sleep, now: c.now })).toMatchObject({ ok: false, status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a builder that never comes back is reported honestly after about a minute", async () => {
    const c = clock();
    const fetcher = (async () => draining()) as unknown as typeof fetch;
    const job = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    expect(await dispatchAgentJob(job, fetcher, ENV, { sleep: c.sleep, now: c.now })).toMatchObject({ ok: false, status: 503 });
    expect(c.elapsed()).toBeLessThanOrEqual(75_000);
  });

  it("a build handed over during a 60-second drain plus swap still gets through", async () => {
    const c = clock();
    const send = async () => {
      if (c.elapsed() < 60_000) return draining();
      if (c.elapsed() < 90_000) throw new Error("fetch failed"); // container swap
      return new Response("{}", { status: 202 });
    };
    const res = await sendWithBuilderRetry(send, {
      delaysMs: BUILD_DISPATCH_RETRY_DELAYS_MS,
      retryNetworkErrors: true,
      maxTotalMs: BUILD_DISPATCH_MAX_TOTAL_MS,
      sleep: c.sleep,
      now: c.now,
    });
    expect(res.status).toBe(202);
  });

  it("sub-calls (/exec, /browse) never re-send after a network error", async () => {
    const send = vi.fn(async () => {
      throw new Error("Network connection lost");
    });
    await expect(sendWithBuilderRetry(send, { delaysMs: [1, 1], retryNetworkErrors: false, sleep: async () => {} })).rejects.toThrow(
      "Network connection lost",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
