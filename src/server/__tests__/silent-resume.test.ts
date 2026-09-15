import { describe, it, expect } from "vitest";
import { isTransientFailure, classifyRawError } from "@/server/self-recovery.server";

describe("isTransientFailure", () => {
  const t = (raw: string) => isTransientFailure(classifyRawError(raw), raw, false);

  it("treats provider and transport failures as retryable", () => {
    expect(t("upstream: 502 bad gateway")).toBe(true);
    expect(t("The operation was aborted due to timeout")).toBe(true);
    expect(t("rate limit exceeded (429)")).toBe(true);
    expect(t("fetch failed")).toBe(true);
    expect(t("socket hang up")).toBe(true);
    expect(t("operation was aborted due to timeout (stream idle)")).toBe(true);
    expect(t("the response was cut off before it finished")).toBe(true);
  });

  it("never retries failures the user has to act on", () => {
    expect(t("You're out of credits")).toBe(false);
    expect(t("401 unauthorized")).toBe(false);
    expect(
      t("AI credits exhausted — Settings → Workspace → Usage"),
    ).toBe(false);
  });

  it("never retries a cancellation", () => {
    expect(isTransientFailure("upstream_timeout", "fetch failed", true)).toBe(false);
  });

  it("leaves genuine generation problems to the normal path", () => {
    expect(t("model returned no ops")).toBe(false);
    expect(t("invalid project data")).toBe(false);
  });
});
