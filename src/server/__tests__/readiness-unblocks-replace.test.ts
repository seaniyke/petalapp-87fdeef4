import { describe, expect, it } from "vitest";
import { blockedByReadiness } from "@/server/engine/tool-loop";

describe("blockedByReadiness", () => {
  it("is false when readiness is missing or ready", () => {
    expect(blockedByReadiness(null, "src/pages/Orders.tsx")).toBe(false);
    expect(blockedByReadiness({ ready: true, findings: [] }, "src/pages/Orders.tsx")).toBe(false);
  });

  it("is true for a file the live-data gate blames, so it can be replaced", () => {
    const readiness = {
      ready: false,
      findings: [{ gate: "routes", reason: "shows only sample data", paths: ["src/pages/Orders.tsx"] }],
    };
    expect(blockedByReadiness(readiness, "src/pages/Orders.tsx")).toBe(true);
  });

  it("leaves unrelated clean files protected", () => {
    const readiness = {
      ready: false,
      findings: [{ gate: "routes", reason: "shows only sample data", paths: ["src/pages/Orders.tsx"] }],
    };
    expect(blockedByReadiness(readiness, "src/components/app-layout.tsx")).toBe(false);
  });
});
