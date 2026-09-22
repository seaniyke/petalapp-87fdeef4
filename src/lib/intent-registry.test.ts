import { describe, expect, it } from "vitest";
import { detectCapabilityAsk } from "./intent-registry";

describe("detectCapabilityAsk", () => {
  it("fires on a direct request", () => {
    expect(detectCapabilityAsk("payment", "add a checkout page so people can pay")).toBeTruthy();
    expect(detectCapabilityAsk("email", "send an email when someone books")).toBeTruthy();
    expect(detectCapabilityAsk("backend", "users should sign up and log in")).toBeTruthy();
  });

  it("stays quiet on the mere mention that used to trigger a banner", () => {
    // "store" alone is a page, not a request to take money.
    expect(detectCapabilityAsk("payment", "build a habit tracker")).toBeNull();
  });

  it("respects negation, deferral and pretend data", () => {
    expect(detectCapabilityAsk("payment", "a landing page with no checkout")).toBeNull();
    expect(detectCapabilityAsk("payment", "we'll add subscriptions later")).toBeNull();
    expect(detectCapabilityAsk("email", "just mock the email receipts for now")).toBeNull();
  });

  it("ignores questions about the capability", () => {
    expect(detectCapabilityAsk("payment", "can Kimble do subscriptions?")).toBeNull();
    expect(detectCapabilityAsk("backend", "does this support authentication?")).toBeNull();
  });

  it("never reads Kimble's own reply", () => {
    // Only one argument exists — the user's text. Assistant text cannot leak in.
    expect(detectCapabilityAsk("payment", null)).toBeNull();
    expect(detectCapabilityAsk("payment", "")).toBeNull();
  });
});
