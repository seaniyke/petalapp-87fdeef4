import { beforeEach, describe, expect, it, vi } from "vitest";

const completion = vi.fn();
vi.mock("@/server/ai-provider.server", () => ({ aiChatCompletions: completion }));

describe("stream continuation recovery", () => {
  beforeEach(() => completion.mockReset());

  it("uses one fallback, keeps thinking off, and changes only the incomplete file", async () => {
    completion
      .mockRejectedValueOnce(new Error("silent continuation"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "</main>\n}\n" } }] }),
      });
    const { runContinuation } = await import("@/server/stream-continuation.server");
    const files = [
      { path: "src/pages/Done.tsx", content: "export default function Done(){return <main>Done</main>}" },
      { path: "src/pages/Broken.tsx", content: "export default function Broken(){return <main>" },
    ];
    const result = await runContinuation({
      files,
      issues: [{ path: "src/pages/Broken.tsx", kind: "truncation", detail: "cut off" }],
      model: "not-a-build-model",
    });

    expect(completion).toHaveBeenCalledTimes(2);
    expect(completion.mock.calls[0]?.[0].body.reasoning).toEqual({ enabled: false });
    expect(completion.mock.calls[1]?.[0].meta.fallbackNumber).toBe(1);
    expect(result.result.completedFiles).toBe(1);
    expect(result.files.find((f) => f.path === "src/pages/Done.tsx")?.content).toBe(files[0]?.content);
  });

  it("stops after one fallback when both continuation attempts fail", async () => {
    completion
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const { runContinuation } = await import("@/server/stream-continuation.server");
    await runContinuation({
      files: [{ path: "src/pages/Broken.tsx", content: "export default function Broken(){return <main>" }],
      issues: [{ path: "src/pages/Broken.tsx", kind: "truncation", detail: "cut off" }],
      model: "not-a-build-model",
    });
    expect(completion).toHaveBeenCalledTimes(2);
  });
});