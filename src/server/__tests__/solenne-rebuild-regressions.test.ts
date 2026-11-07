import { describe, expect, it } from "vitest";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { splitRequestedItems } from "@/server/prd/prd-requirements";
import { detectIntents } from "@/lib/intent-registry";
import { customerPrivacyIssues } from "@/server/verification/customer-privacy";

// The live Solenne benchmark build (petal-bcf5146e4ce7, 8 Nov 2026).
const SOLENNE =
  "Build a website for Solenne, a small boutique hotel by the sea in Lisbon with 14 rooms, a restaurant and a rooftop terrace. " +
  "Pages: Home, Rooms, Dining, About and Contact. Guests should be able to see the rooms and send a stay request. " +
  "I want it crisp, sleek and modern, with proper typography, premium fonts and sharp photos. Keep the words light.";

describe("live Solenne build regressions", () => {
  it("names the site Solenne, not 'Solenne Small Site'", () => {
    expect(deterministicPrd(SOLENNE).productName).toBe("Solenne");
  });

  it("still ignores a lone capitalised place after 'website for'", () => {
    expect(deterministicPrd("Build a website for Lisbon tours with a booking page").productName).not.toBe("Lisbon");
  });

  it("does not turn 'I want it crisp, sleek and modern' into a feature", () => {
    const items = splitRequestedItems(SOLENNE).map((s) => s.toLowerCase());
    expect(items.some((s) => s.includes("crisp"))).toBe(false);
    expect(items.some((s) => s.includes("want it"))).toBe(false);
  });

  it("gives a site with a stay request form real saved data", () => {
    const ids = detectIntents(SOLENNE, null).map((i) => (typeof i === "string" ? i : (i as { id: string }).id));
    expect(ids).toContain("backend");
  });

  it("leaves a plain brochure website without saved data", () => {
    const ids = detectIntents("Build a website for Aura Light Studio, a lighting studio. Pages: Home, Projects, Contact.", null)
      .map((i) => (typeof i === "string" ? i : (i as { id: string }).id));
    expect(ids).not.toContain("backend");
  });

  it("treats stay requests as private: visitors cannot list everyone's", () => {
    const page = { path: "src/pages/Contact.tsx", content: `const rows = await db.list("stay_requests");` };
    expect(customerPrivacyIssues(page, [page]).length).toBeGreaterThan(0);
  });
});
