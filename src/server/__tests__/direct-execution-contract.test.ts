/**
 * The user contract: a clear request is executed, not turned into a plan.
 * Covers routing (plan vs execute), classification without an AI call, and
 * write scope for small edits.
 */
import { describe, expect, it } from "vitest";
import { shouldAutoPlan, isExplicitPlanRequest } from "../plan-mode";
import { classifyEdit } from "../edit-classifier.server";
import { buildEditBoundary } from "../edit-boundary.server";

const existing = [
  "src/App.tsx",
  "src/pages/HomePage.tsx",
  "src/pages/SignInPage.tsx",
  "src/components/sections/Hero.tsx",
  "src/components/sections/SiteHeader.tsx",
  "src/components/sections/FooterSection.tsx",
];
const plan = (prompt: string) => shouldAutoPlan({ prompt, fileCount: 80, isInitial: false });

// classifyEdit must not reach the network for clear instructions.
async function classifyOffline(prompt: string) {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("network not allowed");
  }) as typeof fetch;
  try {
    const c = await classifyEdit({ prompt, fileCount: 80 });
    return { c, called };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("direct execution contract", () => {
  it("A: 'Add a line under the sign-in form' executes as a small edit", async () => {
    const p = "Add a line under the sign-in form.";
    expect(plan(p)).toBe(false);
    const { c, called } = await classifyOffline(p);
    expect(called).toBe(false);
    expect(c.scope).not.toBe("structural");
    const b = buildEditBoundary({
      scope: c.scope,
      targetPaths: ["src/pages/SignInPage.tsx"],
      neighbourPaths: ["src/App.tsx"],
      existingPaths: existing,
    });
    expect(b.allows("src/pages/SignInPage.tsx")).toBe(true);
    expect(b.allows("src/App.tsx")).toBe(false);
    expect(b.allows("src/pages/HomePage.tsx")).toBe(false);
    expect(b.allows("src/pages/AboutPage.tsx")).toBe(false);
  });

  it("A (long form): the earlier failing prompt no longer becomes a plan", () => {
    expect(
      plan(
        "On the sign-in page, add a short line under the form: 'New here? Create an account' linking to the sign-up page, and style it to match the page.",
      ),
    ).toBe(false);
  });

  it("B: 'Change the main heading on the home page' — direct, no AI routing call", async () => {
    const p = "Change the main heading on the home page.";
    expect(plan(p)).toBe(false);
    const { called } = await classifyOffline(p);
    expect(called).toBe(false);
  });

  it("C: two-column request — direct, neighbours readable not writable", async () => {
    const p = "Make the section below the hero two columns on desktop.";
    expect(plan(p)).toBe(false);
    const { c, called } = await classifyOffline(p);
    expect(called).toBe(false);
    const b = buildEditBoundary({
      scope: c.scope,
      targetPaths: ["src/pages/HomePage.tsx"],
      neighbourPaths: ["src/components/sections/SiteHeader.tsx", "src/components/sections/FooterSection.tsx"],
      existingPaths: existing,
    });
    expect(b.allows("src/pages/HomePage.tsx")).toBe(true);
    expect(b.allows("src/components/sections/SiteHeader.tsx")).toBe(false);
    expect(b.allows("src/components/sections/FooterSection.tsx")).toBe(false);
    expect(b.allows("src/components/sections/FeatureColumns.tsx")).toBe(true);
  });

  it("D: an explicit plan request plans", () => {
    const p = "Give me a plan for how we should build this SaaS.";
    expect(isExplicitPlanRequest(p)).toBe(true);
    expect(plan(p)).toBe(true);
  });

  it("E: a big build instruction builds without an approval step", () => {
    const p =
      "Build a complete SaaS dashboard with authentication, billing, projects and team management.";
    expect(plan(p)).toBe(false);
    expect(shouldAutoPlan({ prompt: p, fileCount: 0, isInitial: true })).toBe(false);
  });

  it("a request that adds a page may create it", () => {
    const b = buildEditBoundary({
      scope: "targeted",
      targetPaths: ["src/pages/HomePage.tsx"],
      existingPaths: existing,
      allowNewPages: true,
    });
    expect(b.allows("src/pages/ContactPage.tsx")).toBe(true);
    expect(b.allows("src/App.tsx")).toBe(true);
  });
});
