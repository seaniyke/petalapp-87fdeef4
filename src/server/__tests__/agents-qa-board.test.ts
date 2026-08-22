import { describe, it, expect } from "vitest";
import { routeDefects, renderRepairBrief, summarizeRouting } from "@/server/agents/qa-board";

describe("QA board defect routing", () => {
  it("returns an empty routing for no defects", () => {
    const r = routeDefects({});
    expect(r.defects).toHaveLength(0);
    expect(r.brief).toBe("");
    expect(summarizeRouting(r)).toContain("no defects");
  });

  it("assigns each defect class to the layer that owns it", () => {
    const r = routeDefects({
      blocking: [
        "Uncaught TypeError: cannot read properties of undefined on /dashboard",
        "RLS policy missing on public.notes — rows are readable by anyone",
        "404 on route /pricing referenced from the nav",
      ],
      visual: ["Hero heading is clipped and overlaps the CTA button"],
      advisory: ["Slow request: /assets/hero.png took 2400ms"],
    });
    const owners = Object.fromEntries(r.defects.map((d) => [d.kind, d.owner]));
    expect(owners.runtime).toBe("frontend");
    expect(owners.security).toBe("security");
    expect(owners.navigation).toBe("architecture");
    expect(owners.visual).toBe("design");
    expect(r.defects).toHaveLength(5);
  });

  it("orders blocking owners by precedence, security first", () => {
    const r = routeDefects({
      blocking: [
        "Hero heading is clipped and overlaps the CTA",
        "Service role key exposed in the client bundle",
      ],
    });
    expect(r.blockingOwners[0]).toBe("security");
  });

  it("builds an owner-grouped brief and excludes advisory noise", () => {
    const r = routeDefects({
      blocking: ["Uncaught ReferenceError in App"],
      advisory: ["Missing favicon"],
    });
    expect(r.brief).toContain("REPAIR BRIEF");
    expect(r.brief).toContain("Frontend implementation");
    expect(r.brief).not.toContain("favicon");
  });

  it("falls back to frontend ownership for unrecognised findings", () => {
    const r = routeDefects({ blocking: ["Something inexplicable happened"] });
    expect(r.defects[0].kind).toBe("unknown");
    expect(r.defects[0].owner).toBe("frontend");
  });

  it("renderRepairBrief is empty when only advisory defects exist", () => {
    const r = routeDefects({ advisory: ["Missing apple-touch-icon"] });
    expect(renderRepairBrief(r.defects)).toBe("");
  });
});
