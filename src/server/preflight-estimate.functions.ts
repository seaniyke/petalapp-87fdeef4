/**
 * Server function wrapper for the pre-flight cost estimator.
 * Client imports this; the .server.ts module stays out of the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { estimatePromptCost, type PreflightEstimate } from "./preflight-estimate.server";

export const estimatePromptCostFn = createServerFn({ method: "POST" })
  .inputValidator((data: { prompt: string }) => {
    if (typeof data?.prompt !== "string") {
      throw new Error("prompt must be a string");
    }
    return { prompt: data.prompt.slice(0, 4000) };
  })
  .handler(async ({ data }): Promise<PreflightEstimate> => {
    return estimatePromptCost(data.prompt);
  });
