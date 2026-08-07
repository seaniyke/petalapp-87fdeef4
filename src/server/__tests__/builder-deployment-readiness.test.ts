import { describe, expect, it } from "vitest";
import {
  deploymentUrlFromWranglerOutput,
  isTransientDeploymentStatus,
} from "../../../builder/src/build";
import { isTransientEdgeStatus } from "../../../builder/src/deploy-status";
import { allBlockingDefectsAreTransientEdge } from "@/lib/verification-report";

describe("builder deployment readiness", () => {
  it("selects the immutable deployment URL rather than mutable aliases", () => {
    const output = [
      "Deployment complete! Take a peek over at https://a1b2c3d4.petal-abc123.pages.dev",
      "Deployment alias URL: https://main.petal-abc123.pages.dev",
      "Production URL: https://petal-abc123.pages.dev",
    ].join("\n");

    expect(deploymentUrlFromWranglerOutput(output, "petal-abc123")).toBe(
      "https://a1b2c3d4.petal-abc123.pages.dev",
    );
  });

  it("falls back to the stable URL when Wrangler omits a deployment URL", () => {
    expect(deploymentUrlFromWranglerOutput("Deployment complete", "petal-abc123")).toBe(
      "https://petal-abc123.pages.dev",
    );
  });

  it("treats edge propagation responses, including 522, as retryable", () => {
    for (const status of [404, 429, 502, 503, 522, 524]) {
      expect(isTransientDeploymentStatus(status)).toBe(true);
    }
    expect(isTransientDeploymentStatus(401)).toBe(false);
  });

  it("retries transient gateway failures during individual browser routes", () => {
    for (const status of [502, 503, 504, 520, 521, 522, 523, 524, 530]) {
      expect(isTransientEdgeStatus(status)).toBe(true);
    }
    expect(isTransientEdgeStatus(404)).toBe(false);
    expect(isTransientEdgeStatus(500)).toBe(false);
  });
});
describe("edge-noise verification findings", () => {
  it("treats an all-52x browser report as inconclusive, not a build failure", () => {
    expect(
      allBlockingDefectsAreTransientEdge([
        "/ returned HTTP 522.",
        "/about console error: Failed to load resource: the server responded with a status of 522 ()",
      ]),
    ).toBe(true);
  });

  it("still blocks when a real runtime defect is present", () => {
    expect(
      allBlockingDefectsAreTransientEdge(["/ returned HTTP 522.", "/posts rendered a blank page"]),
    ).toBe(false);
    expect(allBlockingDefectsAreTransientEdge([])).toBe(false);
  });
});
