import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-token", () => ({
  getSupabaseAccessToken: async () => "test-token",
}));

import { streamGenerate } from "@/lib/stream";

function sseResponse(events: object[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const baseBody = {
  messages: [{ role: "user" as const, content: "change the hero" }],
  currentFiles: [{ path: "src/App.tsx", content: "export default () => null" }],
  planFirst: true,
};

describe("streamGenerate — plan turns end cleanly", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("plan_proposed + done ends the turn with no reconnect and no error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        {
          type: "plan_proposed",
          planId: "p1",
          summary: "Do the thing",
          risk: "low",
          files: [{ path: "src/App.tsx", intent: "edit", reason: "hero" }],
          auto: true,
        },
        { type: "done", status: "plan_proposed" },
      ]),
    );

    let proposed: { planId: string } | null = null;
    let done: string | null = null;
    let error: string | null = null;
    await streamGenerate(baseBody, {
      onPlanProposed: (p) => {
        proposed = p;
      },
      onDone: (s) => {
        done = s;
      },
      onError: (m) => {
        error = m;
      },
    });

    expect(proposed).toEqual(expect.objectContaining({ planId: "p1" }));
    expect(done).toBe("plan_proposed");
    expect(error).toBeNull();
    // Exactly one request — no resume/reconnect attempt against a turn that
    // never existed server-side.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a bare EOF after plan_proposed (no done frame) is still a completed turn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        { type: "plan_proposed", planId: "p1", summary: "s", risk: "low", files: [] },
      ]),
    );

    let done: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onDone: (s) => {
          done = s;
        },
      }),
    ).resolves.toBeUndefined();
    expect(done).toBe("plan_proposed");
  });

  it("plan_skipped ends cleanly so the caller can resend the real turn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([{ type: "plan_skipped", reason: "planning_failed" }]),
    );

    let skipped: string | null = null;
    await expect(
      streamGenerate(baseBody, {
        onPlanSkipped: (r) => {
          skipped = r;
        },
      }),
    ).resolves.toBeUndefined();
    expect(skipped).toBe("planning_failed");
  });

  it("a plan-stream error surfaces the real error, not a reconnect failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        { type: "error", message: "Kimble couldn't draft a plan for that request." },
        { type: "done", status: "failed" },
      ]),
    );

    let error: string | null = null;
    let done: string | null = null;
    await streamGenerate(baseBody, {
      onError: (m) => {
        error = m;
      },
      onDone: (s) => {
        done = s;
      },
    });
    expect(error).toContain("couldn't draft a plan");
    expect(done).toBe("failed");
  });
});
