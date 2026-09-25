import { describe, expect, it } from "vitest";
import { finalDepth, initialDepth, needsBrowser } from "@/server/execution/depth";
import { TurnLedger } from "@/server/execution/ledger";
import { renderLifecycleContext } from "@/server/context/lifecycle";
import { creditPurposeFor, toOperationType, transitionAllowed } from "@/lib/operation-identity";

const cls = (operation: string, extra: Record<string, unknown> = {}) => ({ operation, edit: null, crossCutting: false, ...extra }) as never;

describe("execution depth", () => {
  it("first build is full verification", () => {
    expect(initialDepth(cls("first_build"), "hotel site")).toBe("FULL_VERIFICATION");
  });
  it("micro copy change starts at source validation but the platform floor still builds", () => {
    const d = initialDepth(cls("content_change", { edit: { scope: "micro" } }), "change the headline");
    expect(d).toBe("SOURCE_VALIDATION_ONLY");
    expect(finalDepth(d, ["src/routes/index.tsx"], { codeChanged: true }).depth).toBe("BUILD_PLUS_BROWSER");
  });
  it("impact analysis escalates on dependency, backend, auth and payment paths", () => {
    for (const p of ["package.json", "src/server/x.server.ts", "src/routes/login.tsx", "src/components/Checkout.tsx", "supabase/migrations/a.sql"]) {
      const r = finalDepth("BUILD", [p], { codeChanged: true });
      expect(r.depth).toBe("FULL_VERIFICATION");
      expect(r.escalatedBy[0].path).toBe(p);
    }
  });
  it("never lowers the initial depth", () => {
    expect(finalDepth("FULL_VERIFICATION", ["src/styles.css"], { codeChanged: true }).depth).toBe("FULL_VERIFICATION");
  });
  it("an explicit test request needs the browser", () => {
    expect(needsBrowser(initialDepth(cls("styling_change"), "make it blue and test it"))).toBe(true);
  });
});

describe("read-before-edit", () => {
  it("refuses overwriting an existing file that was not read", () => {
    const l = new TurnLedger();
    const r = l.write("src/a.tsx", "new", "old", "edit", "primary");
    expect(r.ok).toBe(false);
  });
  it("allows the write after the file was read, and new files need no read", () => {
    const l = new TurnLedger();
    l.recordRead("src/a.tsx");
    expect(l.write("src/a.tsx", "new", "old", "edit", "primary").ok).toBe(true);
    expect(l.write("src/new.tsx", "x", undefined, "create", "primary").ok).toBe(true);
  });
  it("reads do not carry over to a new operation", () => {
    const a = new TurnLedger();
    a.recordRead("src/a.tsx");
    expect(new TurnLedger().hasRead("src/a.tsx")).toBe(false);
  });
});

describe("operation identity", () => {
  it("purpose is server-derived: BUILD needs an allow-listed type AND a new revision", () => {
    expect(creditPurposeFor(toOperationType("styling_change", { isInitial: false }), true)).toBe("BUILD");
    expect(creditPurposeFor("ITERATION", false)).toBe("NON_BUILD");
    expect(creditPurposeFor("SOMETHING_UNKNOWN", true)).toBe("NON_BUILD");
    expect(toOperationType("anything", { isInitial: true })).toBe("FIRST_BUILD");
  });
  it("terminal settlement states cannot move", () => {
    expect(transitionAllowed("SETTLED", "BUILDING")).toBe(false);
    expect(transitionAllowed("REFUNDED", "SETTLED")).toBe(false);
    expect(transitionAllowed("READY", "FAILED")).toBe(false);
  });
});

describe("lifecycle context", () => {
  const base = {
    operationType: "STYLING_CHANGE", executionDepth: "BUILD" as const, currentRevision: 7, buildRevision: 7, buildStatus: "ready",
    publishedRevision: 5, designSystem: "kimble-test-system", accent: "teal", routes: ["/", "/rooms"], relevantFiles: ["src/routes/index.tsx"],
    recentChanges: [], knownIssues: [],
  };
  it("iteration context states existing app, revisions and design system", () => {
    const t = renderLifecycleContext({ ...base, isInitial: false });
    expect(t).toContain("ITERATION_CONTEXT");
    expect(t).toContain("EXISTING application");
    expect(t).toContain("revision 7");
    expect(t).toContain("revision 5");
    expect(t).toContain("kimble-test-system");
    expect(t).not.toContain("FIRST_BUILD_CONTEXT");
  });
  it("first build context has no iteration rules", () => {
    const t = renderLifecycleContext({ ...base, isInitial: true });
    expect(t).toContain("FIRST_BUILD_CONTEXT");
    expect(t).not.toContain("ITERATION_CONTEXT");
  });
});
