import { describe, expect, it } from "vitest";
import { hoursOwed, type ComputeBillingRow } from "@/server/compute.server";

const HOUR = 3_600_000;
const now = Date.parse("2026-01-01T12:00:00.000Z");

function row(partial: Partial<ComputeBillingRow>): ComputeBillingRow {
  return {
    projectId: "p1",
    ownerId: "u1",
    awakeSince: null,
    billedThrough: null,
    lastActiveAt: null,
    ...partial,
  };
}

describe("hoursOwed", () => {
  it("bills nothing for a container that was never awake", () => {
    expect(hoursOwed(row({}), now)).toBe(0);
  });

  it("bills whole hours only", () => {
    expect(hoursOwed(row({ billedThrough: new Date(now - 2.9 * HOUR).toISOString() }), now)).toBe(2);
  });

  it("bills nothing for less than one hour awake", () => {
    expect(hoursOwed(row({ awakeSince: new Date(now - 59 * 60_000).toISOString() }), now)).toBe(0);
  });

  it("settles from the last billed point, not from wake-up", () => {
    const r = row({
      awakeSince: new Date(now - 10 * HOUR).toISOString(),
      billedThrough: new Date(now - 3 * HOUR).toISOString(),
    });
    expect(hoursOwed(r, now)).toBe(3);
  });

  it("never goes negative when the clock is behind", () => {
    expect(hoursOwed(row({ billedThrough: new Date(now + 5 * HOUR).toISOString() }), now)).toBe(0);
  });

  it("ignores an unparseable timestamp", () => {
    expect(hoursOwed(row({ billedThrough: "not-a-date" }), now)).toBe(0);
  });
});
