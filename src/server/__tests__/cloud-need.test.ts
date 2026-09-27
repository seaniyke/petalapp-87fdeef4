import { describe, expect, it } from "vitest";
import { deriveIntentContract, renderIntentBlock } from "@/server/prd/intent-contract";
import { resolveIntentActions } from "@/server/intent-actions.server";

const needs = (t: string) => {
  const s = deriveIntentContract(t, null).surface;
  return s === "app" || s === "public+app";
};

describe("product decides whether Kimble Cloud is needed", () => {
  it("websites do not need it", () => {
    expect(needs("Build me a portfolio website")).toBe(false);
    expect(needs("Build me a hotel website")).toBe(false);
  });
  it("applications do", () => {
    expect(needs("Build me a delivery management platform where customers create accounts and drivers manage deliveries")).toBe(true);
    expect(needs("Build me a project management SaaS")).toBe(true);
    expect(needs("Build me a hospital management system")).toBe(true);
  });
  it("public+app contract forbids duplicate and navigation-only pages", () => {
    const b = renderIntentBlock(deriveIntentContract("Build me a hospital management system", null));
    expect(b).toMatch(/pathless layout/);
    expect(b).toMatch(/no duplicate routes/);
  });
  it("never reports cloud as enabled without a project to enable it on", async () => {
    const r = await resolveIntentActions({
      projectId: null,
      prompt: "Build me a project management SaaS",
      hasBackend: false,
      hasSharedBackend: false,
      productNeedsBackend: { reason: "needs accounts" },
    });
    expect(r.cloud.needed).toBe(true);
    expect(r.cloud.status).toBe("failed");
    expect(r.promptBlock).toMatch(/could NOT be switched on/);
  });
});
