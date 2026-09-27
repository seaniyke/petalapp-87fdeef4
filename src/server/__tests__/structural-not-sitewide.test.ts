import { describe, expect, it } from "vitest";
import { classifyRequest } from "../execution/classify";
import { buildExecutionScope } from "../execution/scope";

const manifest = {
  pages: [
    { path: "src/pages/Dashboard.tsx", type: "dashboard" },
    { path: "src/pages/Patients.tsx", type: "patients" },
    { path: "src/pages/Billing.tsx", type: "billing" },
  ],
  layouts: ["src/components/AppLayout.tsx"],
} as never;

describe("structural edits on one page are not site-wide", () => {
  it("a structural single-page edit keeps page and layout protection", () => {
    const req = "The patients table looks plain, give it a proper toolbar and status badges.";
    const c = classifyRequest(req, { isInitial: false });
    expect(c.edit?.scope).toBe("structural");
    expect(c.crossCutting).toBe(false);
    const s = buildExecutionScope({ request: req, classification: c, manifest, targets: ["src/pages/Patients.tsx"] });
    expect(s.isProtected("src/pages/Patients.tsx")).toBe(false);
    expect(s.isProtected("src/pages/Billing.tsx")).toBe(true);
    expect(s.isProtected("src/components/AppLayout.tsx")).toBe(true);
  });

  it("a genuine site-wide request is still cross-cutting", () => {
    const c = classifyRequest("Change the header and footer on every page to use the new brand colours.", { isInitial: false });
    expect(c.crossCutting).toBe(true);
  });

  it("the dashboard button change stays a scoped small edit", () => {
    const req = "Change the appointment button on the dashboard.";
    const c = classifyRequest(req, { isInitial: false });
    expect(c.crossCutting).toBe(false);
    expect(c.edit?.scope).not.toBe("structural");
    const s = buildExecutionScope({ request: req, classification: c, manifest, targets: ["src/pages/Dashboard.tsx"] });
    expect(s.isProtected("src/pages/Patients.tsx")).toBe(true);
  });
});
