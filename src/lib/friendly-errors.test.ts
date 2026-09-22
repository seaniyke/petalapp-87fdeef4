import { describe, expect, it } from "vitest";
import {
  isInfrastructureBuildError,
  isRenderableFriendlyError,
} from "./friendly-errors";

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

describe("isInfrastructureBuildError", () => {
  it("recognizes exhausted watchdog retries as service failures", () => {
    expect(
      isInfrastructureBuildError(
        "The build service didn't respond after multiple attempts. Please try again in a moment.",
      ),
    ).toBe(true);
  });

  it("does not misclassify an app compile error", () => {
    expect(isInfrastructureBuildError("src/App.tsx: Unexpected token")).toBe(false);
  });
});