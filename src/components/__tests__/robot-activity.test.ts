import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { robotActivity } from "@/lib/robot-activity";

describe("real robot activity", () => {
  it("covers initial thinking before the activity card mounts", () => {
    expect(robotActivity("idle", "idle", { busy: true }).active).toBe(true);
    expect(robotActivity("running", "understanding", { busy: true })).toEqual({
      active: true,
      failed: false,
      phaseId: "thinking",
    });
  });
  it("maps real work to its specialist without a phase timer", () => {
    for (const [stage, phase] of [
      ["planning", "designing"],
      ["writing", "writing"],
      ["repairing", "writing"],
      ["verifying", "polishing"],
      ["building", "deploying"],
    ] as const) {
      expect(robotActivity("running", stage, { busy: true }).phaseId).toBe(phase);
    }
  });
  it("terminal and waiting states override stale busy flags", () => {
    for (const lifecycle of [
      "ready",
      "failed",
      "cancelled",
      "build_failed",
      "verify_failed",
      "answered",
      "awaiting_approval",
      "paused",
      "stopping",
    ]) {
      expect(robotActivity(lifecycle, "writing", { busy: true, isDeploying: true }).active).toBe(
        false,
      );
    }
  });
  it("has just one robot scene, outside the conditional activity card", () => {
    const builder = readFileSync("src/routes/builder.tsx", "utf8");
    const card = readFileSync("src/components/BuildActivityCard.tsx", "utf8");
    expect(builder.match(/<RobotCrew/g)).toHaveLength(1);
    expect(card).not.toContain("RobotCrew");
    expect(builder).toContain("liveRobots.active || activityVisible");
    const early = builder.slice(
      builder.indexOf("if (earlyEcho) {"),
      builder.indexOf("const proj = await ensureProject()"),
    );
    expect(early.indexOf('dispatchTurn({ type: "reset" })')).toBeLessThan(
      early.indexOf("setBusy(true)"),
    );
  });
  it("uses real joint articulation and no delayed terminal motion", () => {
    const robot = readFileSync("src/components/build/IndustrialRobot.tsx", "utf8");
    const crew = readFileSync("src/components/build/RobotCrew.tsx", "utf8");
    expect(robot).toContain("Math.acos");
    expect(robot).toContain("if (!moving || !selected) return");
    expect(crew).toContain("moving={working && visible && !reduced}");
    expect(crew).not.toContain("setTimeout");
  });
});
