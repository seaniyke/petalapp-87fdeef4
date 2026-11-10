import { describe, expect, it } from "vitest";
import {
  displayPrefix,
  generateKey,
  hashKey,
  hasScope,
  looksLikeDeveloperKey,
  normalizeScopes,
  requiredScope,
} from "../developer-keys";

describe("developer keys", () => {
  it("generates sk_custard_ keys with a 40-char body, all distinct", () => {
    const keys = new Set(Array.from({ length: 50 }, generateKey));
    expect(keys.size).toBe(50);
    for (const k of keys) {
      expect(k.startsWith("sk_custard_")).toBe(true);
      expect(k.length).toBe(51);
      expect(looksLikeDeveloperKey(k)).toBe(true);
    }
  });

  it("rejects the master key shape and tampered keys", () => {
    expect(looksLikeDeveloperKey("some-long-shared-master-key-value")).toBe(false);
    expect(looksLikeDeveloperKey("sk_custard_short")).toBe(false);
    expect(looksLikeDeveloperKey(generateKey() + "x")).toBe(false);
  });

  it("hashes deterministically to 64 hex chars and never equals the key", async () => {
    const k = generateKey();
    const h = await hashKey(k);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashKey(k)).toBe(h);
    expect(h).not.toContain(k);
  });

  it("shows only a short prefix", () => {
    expect(displayPrefix("sk_custard_ABCDEFGH")).toBe("sk_custard_ABCD");
  });

  it("reads need projects:read, other methods need projects:write", () => {
    expect(requiredScope("GET")).toBe("projects:read");
    expect(requiredScope("POST")).toBe("projects:write");
    expect(requiredScope("DELETE")).toBe("projects:write");
  });

  it("write implies read, read never implies write", () => {
    expect(hasScope(["projects:write"], "projects:read")).toBe(true);
    expect(hasScope(["projects:read"], "projects:write")).toBe(false);
    expect(hasScope([], "projects:read")).toBe(false);
  });

  it("defaults to read+write and refuses unknown scopes", () => {
    expect(normalizeScopes(undefined)).toEqual(["projects:read", "projects:write"]);
    expect(normalizeScopes(["projects:read"])).toEqual(["projects:read"]);
    expect(normalizeScopes(["admin"])).toBeNull();
    expect(normalizeScopes([])).toBeNull();
  });
});
