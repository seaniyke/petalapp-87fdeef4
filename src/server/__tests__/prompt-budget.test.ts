import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  promptTokenCeiling,
  contextWindowFor,
  anchoredWindows,
  readErrorFrame,
  classifyProviderError,
  userFacingProviderMessage,
} from "@/server/prompt-budget.server";

describe("token estimation", () => {
  it("over-estimates rather than under-estimates", () => {
    const text = "const x = 1;\n".repeat(100);
    expect(estimateTokens(text)).toBeGreaterThan(text.length / 4);
  });

  it("keeps the ceiling under the context window", () => {
    const ceiling = promptTokenCeiling({ model: "deepseek/deepseek-v4-flash", completionBudgetTokens: 16_000 });
    expect(ceiling).toBeLessThan(contextWindowFor("deepseek/deepseek-v4-flash"));
    expect(ceiling).toBeGreaterThan(50_000);
  });

  it("falls back to the smallest window for an unknown model", () => {
    expect(contextWindowFor(null)).toBe(128_000);
  });
});

describe("anchored windows", () => {
  const file = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n");

  it("keeps the region around a late anchor — head truncation never could", () => {
    const out = anchoredWindows(file, { lines: [900], pad: 10 });
    expect(out).toContain("line 900");
    expect(out).not.toContain("\nline 100\n");
    expect(out).toContain("not shown");
  });

  it("merges overlapping anchors into one window", () => {
    const out = anchoredWindows(file, { lines: [500, 505], pad: 20 });
    expect(out.match(/lines \d+-\d+ \*\//g)?.length).toBe(1);
  });

  it("returns the file untouched when there are no usable anchors", () => {
    expect(anchoredWindows(file, { lines: [] })).toBe(file);
  });

  it("respects the line ceiling", () => {
    const out = anchoredWindows(file, { lines: [100, 300, 600, 900], pad: 60, maxLines: 120 });
    const kept = out.split("\n").filter((l) => /^line \d+$/.test(l));
    expect(kept.length).toBeLessThanOrEqual(120);
  });
});

describe("provider error frames", () => {
  it("reads an OpenRouter error frame carried in a 200 stream", () => {
    const frame = JSON.parse(
      '{"error":{"message":"This endpoint\'s maximum context length is 128000 tokens","code":400}}',
    );
    const err = readErrorFrame(frame);
    expect(err?.kind).toBe("context_overflow");
    expect(err?.code).toBe("400");
  });

  it("ignores a normal content frame", () => {
    expect(readErrorFrame({ choices: [{ delta: { content: "hi" } }] })).toBeNull();
  });

  it("classifies capacity, schema and auth refusals apart", () => {
    expect(classifyProviderError("Provider returned 429 rate limit", "429").kind).toBe("capacity");
    expect(classifyProviderError("No available endpoints for this model", null).kind).toBe("capacity");
    expect(classifyProviderError("Invalid tool call schema", "400").kind).toBe("schema_rejected");
    expect(classifyProviderError("Insufficient credits", "402").kind).toBe("auth");
    expect(classifyProviderError("something odd", null).kind).toBe("unknown");
  });

  it("never leaks provider or model names to the user", () => {
    for (const kind of ["context_overflow", "capacity", "schema_rejected", "auth", "unknown"] as const) {
      const line = userFacingProviderMessage(kind);
      expect(line).not.toMatch(/openrouter|deepseek|gemini|claude|token|model/i);
      expect(line.length).toBeLessThan(120);
    }
  });
});
