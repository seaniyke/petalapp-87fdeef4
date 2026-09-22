import { describe, it, expect } from "vitest";
import { normalizeClientTurnId } from "@/server/turn-recorder.server";

describe("normalizeClientTurnId", () => {
  it("accepts well-formed UUIDs (any case)", () => {
    expect(normalizeClientTurnId("123e4567-e89b-42d3-a456-426614174000")).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(normalizeClientTurnId("123E4567-E89B-42D3-A456-426614174000")).toBe(
      "123E4567-E89B-42D3-A456-426614174000",
    );
  });

  it("rejects anything that is not a UUID", () => {
    expect(normalizeClientTurnId("not-a-uuid")).toBeUndefined();
    expect(normalizeClientTurnId("123e4567-e89b-42d3-a456")).toBeUndefined();
    expect(normalizeClientTurnId("123e4567e89b42d3a456426614174000")).toBeUndefined();
    expect(normalizeClientTurnId("")).toBeUndefined();
    // A real turn id belonging to someone else must not be targetable via
    // tricks like whitespace or null-byte padding.
    expect(normalizeClientTurnId(" 123e4567-e89b-42d3-a456-426614174000")).toBeUndefined();
    expect(normalizeClientTurnId("123e4567-e89b-42d3-a456-426614174000\n")).toBeUndefined();
  });

  it("rejects non-strings", () => {
    expect(normalizeClientTurnId(undefined)).toBeUndefined();
    expect(normalizeClientTurnId(null)).toBeUndefined();
    expect(normalizeClientTurnId(42)).toBeUndefined();
    expect(normalizeClientTurnId({})).toBeUndefined();
  });
});
