import { describe, expect, it } from "vitest";
import { makeCallModel, parseToolStream, STREAM_INTERRUPTED, StreamInterruptedFailure } from "@/server/engine/tool-loop-model";

const enc = new TextEncoder();
const frame = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
const call = (index: number, path: string, args?: string) => ({
  choices: [{ index: 0, delta: { tool_calls: [{ index, id: `c${index}`, type: "function", function: { name: "create_file", arguments: args ?? JSON.stringify({ path, content: "x" }) } }] } }],
});

/** A response whose body delivers `frames` and then drops like a lost connection. */
function droppingResponse(frames: Uint8Array[]): Response {
  let i = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (i < frames.length) c.enqueue(frames[i++]);
      else c.error(new Error("Network connection lost."));
    },
  }), { status: 200 });
}

describe("dropped reply stream", () => {
  it("keeps every complete tool call received before the drop", async () => {
    const r = await parseToolStream(droppingResponse([frame(call(0, "src/a.tsx")), frame(call(1, "src/b.tsx"))]), Date.now());
    expect(r.finishReason).toBe(STREAM_INTERRUPTED);
    expect(r.toolCalls.map((c) => JSON.parse(c.function.arguments).path)).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(r.usage).toBeUndefined(); // unmeasured: the build charges it at the estimate
  });

  it("drops a half-received call", async () => {
    const r = await parseToolStream(droppingResponse([frame(call(0, "src/a.tsx")), frame(call(1, "", '{"path":"src/b.tsx","content":"unfin'))]), Date.now());
    expect(r.toolCalls).toHaveLength(1);
  });

  it("re-sends once when nothing usable arrived, then succeeds", async () => {
    let sends = 0;
    const model = makeCallModel(async () => {
      sends++;
      if (sends === 1) return droppingResponse([]);
      return new Response(new ReadableStream({ start(c) { c.enqueue(frame(call(0, "src/a.tsx"))); c.close(); } }), { status: 200 });
    });
    const r = await model([], []);
    expect(sends).toBe(2);
    expect(r.toolCalls).toHaveLength(1);
  });

  it("gives up after one re-send", async () => {
    let sends = 0;
    const model = makeCallModel(async () => { sends++; return droppingResponse([]); });
    await expect(model([], [])).rejects.toBeInstanceOf(StreamInterruptedFailure);
    expect(sends).toBe(2);
  });

  it("does not salvage when the caller cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(parseToolStream(droppingResponse([frame(call(0, "src/a.tsx"))]), Date.now(), ac.signal)).rejects.toThrow("Network connection lost.");
  });
});
