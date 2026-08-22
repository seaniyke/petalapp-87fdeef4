import { describe, expect, it } from "vitest";
import { orchestrateTurn } from "@/server/agents/orchestrator.server";
import { createTurnContext } from "@/server/agents/context";
import { planWaves, scoreComplexity, selectAgents } from "@/server/agents/selection";
import { AGENT_REGISTRY, ALL_AGENTS } from "@/server/agents/registry";

describe("agent selection", () => {
  it("gives a cosmetic follow-up edit the micro profile", () => {
    const ctx = createTurnContext({
      turnId: "t",
      prompt: "change the hero heading colour to green",
      isInitial: false,
    });
    expect(scoreComplexity(ctx)).toBeLessThanOrEqual(1);
    expect(selectAgents(ctx).profile).toBe("micro");
  });

  it("escalates a stateful, high-stakes brief to the full board", () => {
    const ctx = createTurnContext({
      turnId: "t",
      prompt:
        "Build a lending marketplace with borrower and lender accounts, KYC, payouts and an admin dashboard",
    });
    const sel = selectAgents(ctx);
    expect(sel.profile).toBe("full");
    expect(sel.agents).toContain("security");
    expect(sel.agents).toContain("database");
  });

  it("never invites an agent without its dependencies", () => {
    const ctx = createTurnContext({ turnId: "t", prompt: "Build a recipe app with saved favourites" });
    const sel = selectAgents(ctx);
    for (const name of sel.agents) {
      for (const dep of AGENT_REGISTRY[name].dependsOn) {
        expect(sel.agents).toContain(dep);
      }
    }
  });

  it("orders waves so dependencies always land first", () => {
    const waves = planWaves(ALL_AGENTS);
    const seen = new Set<string>();
    for (const wave of waves) {
      for (const name of wave) {
        for (const dep of AGENT_REGISTRY[name].dependsOn) expect(seen.has(dep)).toBe(true);
      }
      for (const name of wave) seen.add(name);
    }
  });
});

describe("orchestration", () => {
  it("produces a binding decision block for a real product brief", async () => {
    const result = await orchestrateTurn({
      turnId: "t1",
      prompt: "Build a habit tracker with accounts, streaks and a weekly dashboard",
    });
    expect(result.ok).toBe(true);
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.block).toContain("AGREED BUILD DECISIONS");
    expect(result.telemetry.runs.every((r) => r.status !== "failed")).toBe(true);
  });

  it("stays cheap and quiet on a trivial edit", async () => {
    const result = await orchestrateTurn({
      turnId: "t2",
      prompt: "rename the CTA label to Get started",
      isInitial: false,
    });
    expect(result.telemetry.profile).toBe("micro");
    expect(result.telemetry.costMicroUsd).toBe(0);
  });

  it("degrades to an empty block instead of throwing when disabled", async () => {
    const prev = process.env["PETAL_ORCHESTRATOR"];
    process.env["PETAL_ORCHESTRATOR"] = "off";
    try {
      const result = await orchestrateTurn({ turnId: "t3", prompt: "Build a CRM" });
      expect(result.block).toBe("");
      expect(result.decisions).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env["PETAL_ORCHESTRATOR"];
      else process.env["PETAL_ORCHESTRATOR"] = prev;
    }
  });
});
