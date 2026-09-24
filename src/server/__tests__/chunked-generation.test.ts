import { describe, expect, it } from "vitest";
import {
  assessChunking,
  buildChunkInstruction,
  mergeChunk,
  parseStepsFromArgs,
  runChunkedGeneration,
} from "@/server/chunked-generation.server";
import type { FileOp } from "@/server/generate.server";

describe("parseStepsFromArgs", () => {
  it("returns complete steps only", () => {
    const raw = '{"steps":["Add nav","Add pricing page","Wire foot';
    expect(parseStepsFromArgs(raw)).toEqual(["Add nav", "Add pricing page"]);
  });

  it("returns [] when there is no steps array", () => {
    expect(parseStepsFromArgs('{"ops":[]}')).toEqual([]);
  });
});

describe("assessChunking", () => {
  const ops: FileOp[] = [{ op: "update", path: "src/pages/Home.tsx", content: "x" }];

  it("flags a truncated finish reason", () => {
    const a = assessChunking({
      rawArgs: '{"steps":["a","b","c"],"ops":[{"op":"update","path":"src/pages/Home.tsx"',
      finishReason: "length",
      ops,
    });
    expect(a.needed).toBe(true);
    expect(a.reason).toBe("truncated_output");
    expect(a.remainingSteps).toEqual(["b", "c"]);
    expect(a.deliveredPaths).toEqual(["src/pages/Home.tsx"]);
  });

  it("flags an unclosed payload even without a finish reason", () => {
    const a = assessChunking({
      rawArgs: '{"steps":["a","b"],"ops":[{"op":"update","path":"src/pages/Home.tsx"',
      finishReason: null,
      ops,
    });
    expect(a.reason).toBe("unclosed_payload");
  });

  it("flags a plan with more steps than emitted changes", () => {
    const a = assessChunking({
      rawArgs: '{"steps":["a","b","c"],"ops":[]}',
      finishReason: "stop",
      ops,
    });
    expect(a.needed).toBe(true);
    expect(a.reason).toBe("steps_incomplete");
  });

  it("does not chunk a complete single-step turn", () => {
    const a = assessChunking({
      rawArgs: '{"steps":["a"],"ops":[]}',
      finishReason: "stop",
      ops,
    });
    expect(a.needed).toBe(false);
    expect(a.reason).toBe("none");
  });

  it("never chunks when nothing was emitted at all", () => {
    const a = assessChunking({ rawArgs: '{"steps":["a","b"]', finishReason: "length", ops: [] });
    expect(a.needed).toBe(false);
  });
});

describe("mergeChunk", () => {
  it("supersedes a whole-file op for the same path and appends replaces", () => {
    const base = {
      ops: [{ op: "update", path: "a.tsx", content: "old" }] as FileOp[],
      files: [],
    };
    const merged = mergeChunk(base, {
      ops: [
        { op: "update", path: "a.tsx", content: "new" },
        { op: "replace", path: "b.tsx", search: "x", replace: "y" },
      ],
    });
    expect(merged.ops).toHaveLength(2);
    expect(merged.ops[0]).toMatchObject({ path: "a.tsx", content: "new" });
    expect(merged.ops[1]).toMatchObject({ op: "replace", path: "b.tsx" });
    expect(merged.added).toBe(2);
  });

  it("drops structurally unusable entries", () => {
    const merged = mergeChunk(
      { ops: [], files: [] },
      { ops: [{ op: "update", path: "", content: "x" } as FileOp], files: [{ path: "", content: "" }] },
    );
    expect(merged.added).toBe(0);
  });
});

describe("buildChunkInstruction", () => {
  it("names applied paths and remaining steps", () => {
    const text = buildChunkInstruction({
      round: 1,
      isInitial: false,
      deliveredPaths: ["src/pages/Home.tsx"],
      remainingSteps: ["Add pricing page"],
    });
    expect(text).toContain("patch_files");
    expect(text).toContain("src/pages/Home.tsx");
    expect(text).toContain("Add pricing page");
  });
});

describe("runChunkedGeneration", () => {
  const assessment = {
    needed: true,
    reason: "truncated_output" as const,
    remainingSteps: ["b", "c", "d"],
    deliveredPaths: ["a.tsx"],
  };

  it("accumulates work across rounds and stops when the plan is covered", async () => {
    const calls: number[] = [];
    const result = await runChunkedGeneration({
      isInitial: false,
      assessment,
      ops: [{ op: "update", path: "a.tsx", content: "1" }],
      files: [],
      request: async (req) => {
        calls.push(req.round);
        if (req.round === 1) {
          return {
            ops: [
              { op: "update", path: "b.tsx", content: "1" },
              { op: "update", path: "c.tsx", content: "1" },
            ],
            finishReason: "length",
          };
        }
        return { ops: [{ op: "update", path: "d.tsx", content: "1" }], finishReason: "stop" };
      },
    });
    // Recovery table: one truncated_output continuation only.
    expect(calls).toEqual([1]);
    expect(result.ops.map((o) => o.path)).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
    expect(result.added).toBe(2);
  });

  it("stops when a chunk adds nothing new", async () => {
    const result = await runChunkedGeneration({
      isInitial: false,
      assessment,
      ops: [{ op: "update", path: "a.tsx", content: "1" }],
      files: [],
      request: async () => ({ ops: [] }),
    });
    expect(result.rounds).toBe(1);
    expect(result.added).toBe(0);
    expect(result.ops).toHaveLength(1);
  });

  it("never throws when the request fails", async () => {
    const result = await runChunkedGeneration({
      isInitial: false,
      assessment,
      ops: [{ op: "update", path: "a.tsx", content: "1" }],
      files: [],
      request: async () => {
        throw new Error("gateway down");
      },
    });
    expect(result.added).toBe(0);
    expect(result.notes.join(" ")).toContain("gateway down");
  });

  it("caps the number of rounds", async () => {
    let n = 0;
    const result = await runChunkedGeneration({
      isInitial: false,
      assessment: { ...assessment, remainingSteps: ["b", "c", "d", "e", "f", "g"] },
      ops: [{ op: "update", path: "a.tsx", content: "1" }],
      files: [],
      request: async (req) => {
        n++;
        return { ops: [{ op: "update", path: `f${req.round}.tsx`, content: "1" }], finishReason: "length" };
      },
    });
    expect(n).toBe(1);
    expect(result.rounds).toBe(1);
  });
});
