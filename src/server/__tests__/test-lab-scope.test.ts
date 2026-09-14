import { describe, expect, it } from "vitest";
import { scopeCasesToEdit, isCosmeticEdit } from "@/server/test-lab.server";
import type { TestCase } from "@/server/test-plan.server";

const make = (
  id: string,
  priority: TestCase["priority"],
  category: TestCase["category"],
  path: string,
): TestCase => ({
  id,
  title: id,
  priority,
  category,
  actions: [{ action: "goto", path }],
  expect: { noPageErrors: true },
});

describe("test lab scoping", () => {
  const cases = [
    make("app-loads", "P0", "load", "/"),
    make("signup", "P0", "auth", "/signup"),
    make("pricing", "P1", "load", "/pricing"),
    make("dashboard", "P1", "journey", "/dashboard"),
  ];

  it("runs everything on a first build", () => {
    const { run, skipped } = scopeCasesToEdit(cases, []);
    expect(run).toHaveLength(4);
    expect(skipped).toHaveLength(0);
  });

  it("keeps must-work checks and the touched page only", () => {
    const { run, skipped } = scopeCasesToEdit(cases, ["src/pages/Pricing.tsx"]);
    const ids = run.map((c) => c.id);
    expect(ids).toContain("app-loads");
    expect(ids).toContain("signup");
    expect(ids).toContain("pricing");
    expect(ids).not.toContain("dashboard");
    expect(skipped[0].reason).toMatch(/did not touch/);
  });

  it("a cosmetic edit does not pay for auth or journey checks", () => {
    const { run } = scopeCasesToEdit(cases, ["src/styles.css"]);
    expect(run.map((c) => c.id)).toEqual(["app-loads"]);
  });

  it("recognises backend edits as not cosmetic", () => {
    expect(isCosmeticEdit(["src/server/orders.server.ts"])).toBe(false);
    expect(isCosmeticEdit(["src/styles.css"])).toBe(true);
    expect(isCosmeticEdit(["src/components/Hero.tsx"])).toBe(false);
  });
});
