import { describe, expect, it } from "vitest";
import { deriveIntentContract } from "@/server/prd/intent-contract";

describe("aesthetic clinic intent", () => {
  it("an aesthetics clinic booking portal is a booking business, not a hospital", () => {
    const c = deriveIntentContract("Build Aurelia Aesthetics & Wellness Clinic: luxury public site plus a signed-in appointments portal with CRUD");
    expect(c.archetype).toBe("booking");
    expect(c.pages.map((p) => p.route)).not.toContain("/prescriptions");
  });
  it("a hospital management system stays healthcare", () => {
    expect(deriveIntentContract("Build a hospital management system with patients and prescriptions").archetype).toBe("healthcare");
  });
});
