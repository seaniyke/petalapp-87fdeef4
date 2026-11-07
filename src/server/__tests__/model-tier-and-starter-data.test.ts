import { describe, it, expect } from "vitest";
import { defaultFirstBuildModel, defaultTextModel, coerceToConfiguredModel } from "@/lib/ai-model-config";
import { firstBuildBrief } from "@/server/engine/first-build";
import { estimateCostUsdMicro } from "@/server/ai-provider.server";

describe("cognitive model tiering", () => {
  it("first builds use the frontier model, edits keep the fast model", () => {
    expect(defaultFirstBuildModel()).toBe("google/gemini-4-argon");
    expect(defaultTextModel()).toBe("google/gemini-3.8-flash");
  });
  it("the frontier model is not coerced away at the gateway chokepoint", () => {
    expect(coerceToConfiguredModel("google/gemini-4-argon")).toBe("google/gemini-4-argon");
  });
  it("first-build cost estimates use the frontier price (8/40 per M)", () => {
    expect(estimateCostUsdMicro("google/gemini-4-argon", 1_000_000, 1_000_000)).toBe(48_000_000);
  });
});

describe("starter data", () => {
  it("data-backed first builds are told to seed real records", () => {
    expect(firstBuildBrief("crm", [], [], null, { shared: true })).toContain("db.seedOnce");
  });
  it("websites without a backend get no seeding rule", () => {
    expect(firstBuildBrief("bakery site", [], [], null, null)).not.toContain("seedOnce");
  });
});
