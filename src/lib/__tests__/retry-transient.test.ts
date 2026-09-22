import { describe, it, expect } from "vitest";
import { isTransientNetworkError, retryTransient } from "../retry-transient";

describe("isTransientNetworkError", () => {
  it("recognises Safari's dropped-socket error", () => {
    expect(isTransientNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isTransientNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(true);
  });

  it("does not treat application errors as transient", () => {
    expect(isTransientNetworkError(new Error("row level security violation"))).toBe(false);
    expect(isTransientNetworkError(new Error("You're out of credits"))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });
});

describe("retryTransient", () => {
  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const out = await retryTransient(
      async () => {
        calls++;
        if (calls < 3) throw new TypeError("Load failed");
        return "ok";
      },
      { baseDelayMs: 1 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("rethrows a non-transient failure immediately", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls++;
          throw new Error("permission denied");
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow("permission denied");
    expect(calls).toBe(1);
  });

  it("gives up after the attempt budget", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls++;
          throw new TypeError("Load failed");
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("Load failed");
    expect(calls).toBe(2);
  });
});
