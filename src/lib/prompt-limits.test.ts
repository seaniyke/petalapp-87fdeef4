import { describe, expect, it } from "vitest";
import {
  MAX_USER_PROMPT_CHARS,
  MAX_USER_PROMPT_HARD_CEILING_CHARS,
  promptExceedsHardCeiling,
} from "./prompt-limits";

describe("prompt limits", () => {
  it("accepts detailed briefs far beyond the legacy cap", () => {
    expect(MAX_USER_PROMPT_CHARS).toBeGreaterThan(8_000);
    expect(promptExceedsHardCeiling("x".repeat(80_000))).toBe(false);
  });

  it("keeps only an exceptional memory-safety ceiling", () => {
    expect(promptExceedsHardCeiling("x".repeat(MAX_USER_PROMPT_HARD_CEILING_CHARS))).toBe(false);
    expect(promptExceedsHardCeiling("x".repeat(MAX_USER_PROMPT_HARD_CEILING_CHARS + 1))).toBe(true);
  });
});