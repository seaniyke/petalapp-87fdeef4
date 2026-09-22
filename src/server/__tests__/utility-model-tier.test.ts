import { describe, expect, it } from "vitest";
import {
  DEFAULT_UTILITY_MODEL,
  UTILITY_MAX_OUTPUT_TOKENS,
  coerceToConfiguredModel,
  defaultTextModel,
  defaultVisionModel,
  isUtilityFeature,
} from "@/lib/ai-model-config";

describe("utility model tier", () => {
  it("treats short classification features as utility work", () => {
    for (const f of ["triage", "preflight", "memory", "coach", "recovery"]) {
      expect(isUtilityFeature(f)).toBe(true);
    }
    expect(isUtilityFeature("generate")).toBe(false);
    expect(isUtilityFeature(null)).toBe(false);
  });

  it("routes utility calls to the cheap model and builds to the build model", () => {
    expect(coerceToConfiguredModel("google/gemini-3-flash-preview", { utility: true })).toBe(
      DEFAULT_UTILITY_MODEL,
    );
    expect(coerceToConfiguredModel("google/gemini-3-flash-preview", {})).toBe(defaultTextModel());
  });

  it("keeps vision ahead of the utility tier", () => {
    expect(
      coerceToConfiguredModel("gpt-4o", { vision: true, utility: true }),
    ).toBe(defaultVisionModel());
  });

  it("caps utility output at a short answer", () => {
    expect(UTILITY_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(1024);
  });
});
