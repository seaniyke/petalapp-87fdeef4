import { describe, expect, it } from "vitest";
import { renderViewContext, routeCandidatePaths } from "../view-context.server";

const PATHS = [
  "src/pages/Index.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/dashboard/Settings.tsx",
  "src/components/Navbar.tsx",
  "src/styles.css",
];

describe("routeCandidatePaths", () => {
  it("matches a named route to its page file", () => {
    expect(routeCandidatePaths({ path: "/pricing" }, PATHS)[0]).toBe("src/pages/Pricing.tsx");
  });

  it("matches a nested route", () => {
    expect(routeCandidatePaths({ path: "/dashboard/settings" }, PATHS)[0]).toBe(
      "src/pages/dashboard/Settings.tsx",
    );
  });

  it("maps the root route to the home page", () => {
    expect(routeCandidatePaths({ path: "/" }, PATHS)).toContain("src/pages/Index.tsx");
  });

  it("ignores id-like segments", () => {
    const out = routeCandidatePaths({ path: "/pricing/9f8e7d6c5b4a3210" }, PATHS);
    expect(out[0]).toBe("src/pages/Pricing.tsx");
  });

  it("returns nothing without a route", () => {
    expect(routeCandidatePaths(null, PATHS)).toEqual([]);
    expect(routeCandidatePaths({}, PATHS)).toEqual([]);
  });
});

describe("renderViewContext", () => {
  it("describes the open page and its likely files", () => {
    const block = renderViewContext(
      { path: "/pricing", title: "Pricing", heading: "Simple pricing" },
      ["src/pages/Pricing.tsx"],
    );
    expect(block).toContain("/pricing");
    expect(block).toContain("Simple pricing");
    expect(block).toContain("src/pages/Pricing.tsx");
  });

  it("describes a selected element", () => {
    const block = renderViewContext({
      path: "/",
      element: { tag: "button", text: "Get started", sourceFile: "src/pages/Index.tsx", sourceLine: "42" },
    });
    expect(block).toContain("<button>");
    expect(block).toContain("Get started");
    expect(block).toContain("src/pages/Index.tsx:42");
  });

  it("is empty when there is nothing on screen to describe", () => {
    expect(renderViewContext(null)).toBe("");
    expect(renderViewContext({})).toBe("");
  });
});
