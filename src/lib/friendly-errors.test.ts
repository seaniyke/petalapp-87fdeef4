import { describe, expect, it } from "vitest";
import { isRenderableFriendlyError } from "./friendly-errors";

describe("isRenderableFriendlyError", () => {
  it("rejects malformed persisted error payloads", () => {
    expect(isRenderableFriendlyError({})).toBe(false);
    expect(isRenderableFriendlyError({ title: "", message: "" })).toBe(false);
    expect(
      isRenderableFriendlyError({
        title: "Build failed",
        message: "Try again.",
        actionLabel: "Retry",
        actionKind: "unknown-action",
      }),
    ).toBe(false);
  });

  it("accepts complete friendly errors", () => {
    expect(
      isRenderableFriendlyError({
        title: "Build failed",
        message: "Try again.",
        actionLabel: "Retry",
        actionKind: "retry",
      }),
    ).toBe(true);
  });
});