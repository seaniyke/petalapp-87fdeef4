import { describe, expect, it } from "vitest";
import {
  describeSuppressed,
  isTestIdentity,
  redactAll,
  redactSecrets,
  redactWithIdentity,
} from "../test-safety.server";

describe("redactSecrets", () => {
  it("removes JWTs", () => {
    const out = redactSecrets("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef done");
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("[redacted token]");
  });

  it("removes provider and supabase keys", () => {
    expect(redactSecrets("sk_live_abcdefgh12345678")).toContain("[redacted key]");
    expect(redactSecrets("sb_secret_abcdefgh1234")).toContain("[redacted key]");
    expect(redactSecrets("AIzaSyA1234567890abcdefghij")).toContain("[redacted key]");
  });

  it("removes labelled secrets and connection strings", () => {
    expect(redactSecrets('api_key: "hunter2secret"')).toContain("[redacted secret]");
    expect(redactSecrets("postgres://u:p@host:5432/db")).toContain("[redacted connection string]");
  });

  it("leaves ordinary page text alone", () => {
    const text = "Welcome back, Ada. You have 3 bookings today.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("handles empty input", () => {
    expect(redactSecrets(undefined)).toBe("");
    expect(redactAll(undefined)).toEqual([]);
  });
});

describe("redactWithIdentity", () => {
  it("hides the run's throwaway password", () => {
    const out = redactWithIdentity("login failed for Pv-xyz123abc9aA!", {
      password: "Pv-xyz123abc9aA!",
    });
    expect(out).toBe("login failed for [redacted password]");
  });

  it("ignores a missing or trivially short password", () => {
    expect(redactWithIdentity("plain text", null)).toBe("plain text");
    expect(redactWithIdentity("plain text", { password: "ab" })).toBe("plain text");
  });
});

describe("isTestIdentity", () => {
  it("recognises Kimble's own test accounts", () => {
    expect(isTestIdentity("petal-verify+abc123@petal-qa.dev")).toBe(true);
    expect(isTestIdentity("ada@example.com")).toBe(false);
    expect(isTestIdentity(null)).toBe(false);
  });
});

describe("describeSuppressed", () => {
  it("says nothing when nothing was blocked", () => {
    expect(describeSuppressed([])).toBeNull();
  });

  it("counts blocked requests in plain language", () => {
    expect(describeSuppressed(["a"])).toContain("1 request ");
    expect(describeSuppressed(["a", "b"])).toContain("2 requests");
  });
});
