import { describe, expect, it } from "vitest";
import {
  buildTestPlan,
  flowToActions,
  selectCases,
  MAX_CASES,
} from "@/server/test-plan.server";
import type { VerifyPlan } from "@/server/verify-plan.server";

const files = [
  {
    path: "src/App.tsx",
    content: `<Route path="/" /><Route path="/pricing" /><Route path="/auth" /><Route path="/dashboard" />`,
  },
];

const verify: VerifyPlan = {
  routes: ["/", "/pricing", "/auth"],
  auth: {
    signupPath: "/auth",
    loginPath: "/auth",
    email: "petal-verify+x@petal-qa.dev",
    password: "Pv-secret9aA!",
    name: "Petal Verify",
    protectedRoutes: ["/dashboard"],
  },
  flows: [
    {
      name: "Create a booking",
      requiresAuth: true,
      steps: [
        { action: "goto", path: "/dashboard" },
        { action: "fill", selector: "input[name=title]", value: "Cut petal-verify" },
        { action: "click", selector: "text=Book" },
        { action: "expectText", value: "Cut petal-verify" },
      ],
    },
  ],
};

describe("buildTestPlan", () => {
  it("always produces at least a P0 case that opens the app", () => {
    const plan = buildTestPlan({ projectId: "p1", files: [] });
    expect(plan.cases[0]?.id).toBe("app-loads");
    expect(plan.cases[0]?.priority).toBe("P0");
  });

  it("makes the primary journey and protected routes P0 when the app has auth", () => {
    const plan = buildTestPlan({ projectId: "p1", files, verify });
    const byId = Object.fromEntries(plan.cases.map((c) => [c.id, c]));
    expect(byId["journey-create-a-booking"]?.priority).toBe("P0");
    expect(byId["journey-create-a-booking"]?.requiresAuth).toBe(true);
    expect(byId["load-dashboard-authed"]?.priority).toBe("P0");
    expect(plan.identity?.email).toContain("petal-verify+");
    expect(plan.cases.length).toBeLessThanOrEqual(MAX_CASES);
  });

  it("orders P0 before P1 before P2 and never duplicates a case", () => {
    const plan = buildTestPlan({ projectId: "p1", files, verify });
    const order = plan.cases.map((c) => c.priority);
    expect([...order].sort()).toEqual(order);
    expect(new Set(plan.cases.map((c) => c.id)).size).toBe(plan.cases.length);
  });
});

describe("flowToActions", () => {
  it("translates verification steps into browser actions with an expectation", () => {
    const { actions, expect: exp } = flowToActions(verify.flows![0]!);
    expect(actions.map((a) => a.action)).toEqual(["goto", "type", "click", "text"]);
    expect(exp.textIncludes).toBe("Cut petal-verify");
    expect(exp.noPageErrors).toBe(true);
  });
});

describe("selectCases", () => {
  it("drops P2 on a tight budget and keeps only P0 on a minimal one", () => {
    const plan = buildTestPlan({ projectId: "p1", files, verify });
    const tight = selectCases(plan, "tight");
    expect(tight.run.every((c) => c.priority !== "P2")).toBe(true);
    expect(tight.skipped.every((c) => c.priority === "P2")).toBe(true);

    const minimal = selectCases(plan, "minimal");
    expect(minimal.run.every((c) => c.priority === "P0")).toBe(true);
    expect(minimal.run.length + minimal.skipped.length).toBe(plan.cases.length);
  });
});
