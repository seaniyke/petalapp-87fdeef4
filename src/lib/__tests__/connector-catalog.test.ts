import { describe, expect, it } from "vitest";
import { CONNECTORS, connectorStatus, groupByCategory } from "@/lib/connectors/catalog";
import { INTEGRATIONS } from "@/server/integrations/registry.server";

describe("connector catalog", () => {
  it("maps every marketplace integration onto exactly one connector", () => {
    for (const i of INTEGRATIONS) {
      expect(CONNECTORS.filter((c) => c.integrationCode === i.code)).toHaveLength(1);
    }
  });
  it("never points at an unknown integration", () => {
    const codes = new Set(INTEGRATIONS.map((i) => i.code));
    for (const c of CONNECTORS) if (c.integrationCode) expect(codes.has(c.integrationCode)).toBe(true);
  });
  it("derives status from installs", () => {
    const stripe = CONNECTORS.find((c) => c.id === "stripe")!;
    const meta = CONNECTORS.find((c) => c.id === "meta")!;
    expect(connectorStatus(stripe, new Set(["stripe"]))).toBe("connected");
    expect(connectorStatus(stripe, new Set())).toBe("available");
    expect(connectorStatus(meta, new Set())).toBe("setup_required");
  });
  it("groups every connector once", () => {
    expect(groupByCategory().flatMap((g) => g.items)).toHaveLength(CONNECTORS.length);
  });
});
