import { describe, expect, it } from "vitest";
import { aggregateCollections, daysUntil } from "../partner-overview.server";

describe("partner overview", () => {
  it("counts records per collection with latest date, biggest first", () => {
    const out = aggregateCollections([
      { collection: "bookings", created_at: "2026-11-01T10:00:00Z" },
      { collection: "orders", created_at: "2026-11-05T10:00:00Z" },
      { collection: "bookings", created_at: "2026-11-07T10:00:00Z" },
    ]);
    expect(out).toEqual([
      { collection: "bookings", count: 2, latestAt: "2026-11-07T10:00:00Z" },
      { collection: "orders", count: 1, latestAt: "2026-11-05T10:00:00Z" },
    ]);
  });

  it("reports whole days until a domain expires", () => {
    const now = Date.parse("2026-11-08T00:00:00Z");
    expect(daysUntil("2026-12-08T00:00:00Z", now)).toBe(30);
    expect(daysUntil("2026-11-01T00:00:00Z", now)).toBe(-7);
    expect(daysUntil(null, now)).toBeNull();
  });
});
