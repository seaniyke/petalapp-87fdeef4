import { describe, expect, it } from "vitest";
import { isRetryableStatus, nextRetryDelayMs } from "../webhook-outbox";

describe("webhook outbox rules", () => {
  it("backs off 1m, 5m, 15m, 1h, 3h, 6h then stops", () => {
    expect([0, 1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([
      60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000,
    ]);
    expect(nextRetryDelayMs(6)).toBeNull();
  });
  it("retries outages but not rejections", () => {
    expect(isRetryableStatus(null)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });
});
