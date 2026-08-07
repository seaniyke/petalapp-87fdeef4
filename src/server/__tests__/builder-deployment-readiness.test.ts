import { describe, expect, it } from "vitest";
import {
  deploymentUrlFromWranglerOutput,
  isTransientDeploymentStatus,
} from "../../../builder/src/build";

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
});