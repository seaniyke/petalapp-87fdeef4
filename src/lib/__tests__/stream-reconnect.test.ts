import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-token", () => ({
  getSupabaseAccessToken: async () => "test-token",
}));

import { streamGenerate } from "@/lib/stream";

function sseResponse(events: object[], status = 200, headers: Record<string, string> = {}): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(stream, { status, headers });
}

const baseBody = {
  messages: [{ role: "user" as const, content: "change the hero" }],
  currentFiles: [{ path: "src/App.tsx", content: "export default () => null" }],
};

/** fetch mock: the POST to /api/generate gets `generateResponse`; every
 *  resume call to /api/turns/:id/events gets `resumeResponse` (default: 404,
 *  i.e. "no attachable stream", which exhausts the quick-retry budget). */
function mockFetch(generateResponse: Response, resumeResponse?: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/turns/")) {
      return resumeResponse ? resumeResponse() : new Response("not found", { status: 404 });
    }
    return generateResponse;
  });
}

describe("streamGenerate — long offline gaps defer instead of erroring", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("clean EOF after turn_id with no done defers to the watcher", async () => {
    mockFetch(sseResponse([{ type: "turn_id", turnId: "t-1" }]));

    let deferred: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onReconnectDeferred: (id) => {
          deferred = id;
        },
      }),
    ).resolves.toBeUndefined();
    expect(deferred).toBe("t-1");
  }, 15_000);

  it("without a deferred handler the same EOF still throws", async () => {
    mockFetch(sseResponse([{ type: "turn_id", turnId: "t-2" }]));

    await expect(streamGenerate(baseBody, {})).rejects.toThrow(
      /could not reconnect/,
    );
  }, 15_000);

  it("a drop before any turn_id still throws (nothing to resume)", async () => {
    mockFetch(sseResponse([{ type: "status", message: "working…" }]));

    let deferred: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onReconnectDeferred: (id) => {
          deferred = id;
        },
      }),
    ).rejects.toThrow(/could not reconnect/);
    expect(deferred).toBeNull();
  });

  it("409 + x-kimble-turn-id attaches to the already-running turn", async () => {
    const fetchSpy = mockFetch(
      new Response("Turn already accepted", {
        status: 409,
        headers: { "x-kimble-turn-id": "t-9" },
      }),
      () => sseResponse([{ type: "done", status: "succeeded" }]),
    );

    let done: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onDone: (s) => {
          done = s;
        },
      }),
    ).resolves.toBeUndefined();
    expect(done).toBe("succeeded");
    // One POST + one resume attach — never a second build.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const resumeUrl = String(fetchSpy.mock.calls[1][0]);
    expect(resumeUrl).toContain("/api/turns/t-9/events");
  });

  it("409 whose resume cannot complete defers instead of erroring", async () => {
    mockFetch(
      new Response("Turn already accepted", {
        status: 409,
        headers: { "x-kimble-turn-id": "t-10" },
      }),
      () => new Response("not found", { status: 404 }),
    );

    let deferred: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onReconnectDeferred: (id) => {
          deferred = id;
        },
      }),
    ).resolves.toBeUndefined();
    expect(deferred).toBe("t-10");
  });
});
