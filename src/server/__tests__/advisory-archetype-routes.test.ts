/**
 * Archetype/blueprint routes are ADVISORY patterns, never build requirements.
 * Required pages come only from pages the user named, the intent contract,
 * and the product surface. (A template's route list used to fail builds as
 * "missing requested pages" for products outside the known domains.)
 */
import { describe, expect, it } from "vitest";
import { buildBlueprintFor, renderBlueprintBlock } from "@/server/app-composer.server";
import { requestedRoutesFor } from "@/server/engine/build-state";
import { deriveIntentContract } from "@/server/prd/intent-contract";

describe("advisory archetype routes", () => {
  it("the blueprint block presents routes as optional patterns, not commands", () => {
    const composed = buildBlueprintFor("Build me an admin dashboard for my shop", { hasBackend: false });
    expect(composed).toBeTruthy();
    const block = renderBlueprintBlock(composed!.blueprint);
    expect(block).not.toMatch(/use these exact paths/i);
    expect(block).not.toMatch(/build no other pages/i);
    expect(block).not.toMatch(/committed for this build/i);
    expect(block).toMatch(/optional patterns/i);
  });

  it("a generic admin-dashboard request requires no template pages", () => {
    const prompt = "Build me an admin dashboard for my shop";
    const composed = buildBlueprintFor(prompt, { hasBackend: false });
    expect(composed).toBeTruthy();
    // The blueprint still SUGGESTS its routes…
    expect(composed!.blueprint.routes.length).toBeGreaterThan(0);
    // …but generate.ts no longer pushes them into plannedRoutes, so with no
    // user-named pages and no intent-contract pages, nothing is required.
    const required = requestedRoutesFor(prompt, []);
    expect(required).not.toContain("/dashboard/items");
    expect(required).not.toContain("/dashboard/settings");
  });

  it("a recognised domain (hospital) still requires the intent contract's pages", () => {
    const contract = deriveIntentContract("Build me a hospital management system", null);
    expect(contract.pages.length).toBeGreaterThan(0);
    const routes = contract.pages.map((p) => p.route);
    expect(routes).toContain("/patients");
  });

  it("pages the user named are still required", () => {
    const required = requestedRoutesFor("Pages: Home, Menu, About, Contact.", []);
    expect(required).toContain("/");
    expect(required).toContain("/menu");
    expect(required).toContain("/about");
    expect(required).toContain("/contact");
  });
});
