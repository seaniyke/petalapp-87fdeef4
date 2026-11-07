import { describe, it, expect, vi } from "vitest";
import {
  durableAgentEnabled,
  buildAgentJobPayload,
  dispatchAgentJob,
  cancelAgentJob,
  ingressAcceptedResponse,
} from "@/server/durable-agent.server";
import { verifySignature } from "@/server/builder.server";
import {
  AgentPool,
  AgentJobSchema,
  internalGenerateRequest,
  runAgentJob,
  cancelAgent,
} from "../../../builder/src/agent";

const ENV = { USE_DURABLE_AGENT: "1", BUILDER_URL: "https://builder.test", BUILDER_SHARED_SECRET: "s3cret" };
const TURN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const log = { info: () => {}, warn: () => {} };

function job() {
  return AgentJobSchema.parse({
    turnId: TURN,
    userId: USER,
    body: { projectId: "p", messages: [{ role: "user", content: "hi" }] },
    headers: { authorization: "Bearer t", "x-petal-target": "web", cookie: "nope" },
    appOrigin: "https://app.test",
  });
}

describe("durable agent: flag", () => {
  it("flag off → old inline path (disabled)", () => {
    expect(durableAgentEnabled({ ...ENV, USE_DURABLE_AGENT: undefined })).toBe(false);
    expect(durableAgentEnabled({ ...ENV, BUILDER_URL: undefined })).toBe(false);
    expect(durableAgentEnabled(ENV)).toBe(true);
  });
});

describe("durable agent: ingress", () => {
  it("payload keeps the same turnId and only forwarded headers", () => {
    const req = new Request("https://app.test/api/generate", {
      method: "POST",
      headers: { authorization: "Bearer t", cookie: "c", "x-petal-target": "web" },
    });
    const p = buildAgentJobPayload(req, TURN, USER, { projectId: "p" });
    expect(p.body.turnId).toBe(TURN);
    expect(p.headers).toEqual({ authorization: "Bearer t", "x-petal-target": "web" });
    expect(p.appOrigin).toBe("https://app.test");
  });

  it("dispatch is signed and only 202 counts as accepted", async () => {
    let seen: { url: string; headers: Headers; body: string } | null = null;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: String(init.body) };
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const p = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    expect(await dispatchAgentJob(p, fetcher, ENV)).toEqual({ ok: true });
    expect(seen!.url).toBe("https://builder.test/agent/generate");
    expect(
      verifySignature("s3cret", seen!.body, seen!.headers.get("x-petal-timestamp"), seen!.headers.get("x-petal-signature")),
    ).toBe(true);
  });

  it("failed dispatch reports failure honestly", async () => {
    const busy = (async () => new Response("busy", { status: 503 })) as unknown as typeof fetch;
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const p = buildAgentJobPayload(new Request("https://app.test/x"), TURN, USER, {});
    const noRetry = { delaysMs: [] };
    expect(await dispatchAgentJob(p, busy, ENV, noRetry)).toMatchObject({ ok: false, status: 503 });
    expect(await dispatchAgentJob(p, down, ENV, noRetry)).toMatchObject({ ok: false, status: 0 });
  });

  it("accepted response is turn_id then end (client reconnects to events)", async () => {
    const text = await ingressAcceptedResponse(TURN).text();
    expect(text).toBe(`data: {"type":"turn_id","turnId":"${TURN}"}\n\n`);
    expect(text).not.toContain('"done"');
  });

  it("cancel is a signed POST to /agent/cancel, no-op when disabled", async () => {
    const fetcher = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    await cancelAgentJob(TURN, fetcher, { ...ENV, USE_DURABLE_AGENT: "0" });
    expect(fetcher).not.toHaveBeenCalled();
    await cancelAgentJob(TURN, fetcher, ENV);
    expect((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(
      "https://builder.test/agent/cancel",
    );
  });
});

describe("durable agent: builder runner", () => {
  it("internal call attaches to the same turn and drops unknown headers", () => {
    const { url, init } = internalGenerateRequest(job(), "s3cret");
    const h = init.headers as Record<string, string>;
    expect(url).toBe("https://app.test/api/generate");
    expect(h["x-petal-durable-turn"]).toBe(TURN);
    expect(h["x-petal-internal-user"]).toBe(USER);
    expect(h.cookie).toBeUndefined();
    expect(JSON.parse(String(init.body)).turnId).toBe(TURN);
  });

  it("runs the pipeline once and drains to the end, regardless of the browser", async () => {
    const fetcher = vi.fn(async () => new Response("data: {}\n\ndata: {\"type\":\"done\"}\n\n")) as unknown as typeof fetch;
    expect(await runAgentJob(job(), "s", log, fetcher)).toBe("finished");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("the same turn is never run twice concurrently", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetcher = vi.fn(async () => {
      await gate;
      return new Response("x");
    }) as unknown as typeof fetch;
    const a = runAgentJob(job(), "s", log, fetcher);
    const b = runAgentJob(job(), "s", log, fetcher);
    release();
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts the running job", async () => {
    const fetcher = ((_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const p = runAgentJob(job(), "s", log, fetcher);
    await Promise.resolve();
    expect(cancelAgent(TURN)).toBe(true);
    expect(await p).toBe("cancelled");
  });

  it("full slots queue the job instead of dropping it; only a full queue refuses", async () => {
    const pool = new AgentPool(1, 1);
    let release!: () => void;
    const ran: string[] = [];
    expect(pool.tryEnqueue(() => new Promise<void>((r) => (release = () => { ran.push("a"); r(); })))).toBe(true);
    expect(pool.tryEnqueue(async () => { ran.push("b"); })).toBe(true);
    expect(pool.snapshot()).toEqual({ inFlight: 1, queued: 1 });
    expect(pool.tryEnqueue(async () => {})).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual(["a", "b"]);
  });
});
