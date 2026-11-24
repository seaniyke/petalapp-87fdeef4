import { describe, expect, it, vi, beforeEach } from "vitest";
import { verifyFileLocal, verifyFilesLocal } from "../local-verifier";
import { buildEditBoundary } from "../edit-boundary.server";
import { buildExecutionScope } from "../execution/scope";
import { classifyRequest } from "../execution/classify";

const db = vi.hoisted(() => ({ previous: null as Record<string, unknown> | null, written: null as Record<string, unknown> | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query, eq: () => query, neq: () => query,
        not: () => query, order: () => query, limit: () => query,
        update: (row: Record<string, unknown>) => { db.written = row; return query; },
        upsert: (row: Record<string, unknown>) => { db.written = row; return query; },
        maybeSingle: async () => ({ data: db.previous, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return query;
    },
  },
}));
import { openTurnCompletion, recordBuildOutcome, fingerprintDefects } from "../turn-completion.server";

describe("proof-led identifier checks", () => {
  const names = (content: string) => verifyFileLocal("src/pages/Existing.tsx", content)
    .filter(issue => issue.kind === "scope" || issue.kind === "undefined");

  it("does not treat fragment prose before an expression as a variable", () => {
    expect(names(`export function A({name}) { return <><p>Thank you, {name}</p></>; }`)).toEqual([]);
  });
  it("recognizes nested bindings, callbacks and catch variables", () => {
    expect(names(`export function A({rows}) { try { return rows.map(({title, icon: Icon}) => <Icon title={title} />); } catch (error) { return String(error); } }`)).toEqual([]);
  });
  it("ignores erased type names", () => {
    expect(names(`export function A(props: UnknownProps) { return <p>{props.title}</p>; }`)).toEqual([]);
  });
  it("blocks a real undefined expression even without a regex trigger", () => {
    expect(names(`export function A() { return <p>{missingTotal}</p>; }`).some(issue => issue.detail.includes("missingTotal"))).toBe(true);
  });
  it("blocks genuinely missing JSX components", () => {
    expect(names(`export function A() { return <MissingCard />; }`).some(issue => issue.detail.includes("MissingCard"))).toBe(true);
  });
  it("checks JavaScript files too", () => {
    expect(verifyFileLocal("src/value.js", "export const value = missingValue;").some(issue => issue.detail.includes("missingValue"))).toBe(true);
  });
  it("checks only changed authored files in a whole proposed tree", () => {
    const verdict = verifyFilesLocal([
      { path: "src/lib/value.ts", content: "export const value = 3;" },
      { path: "src/pages/A.tsx", content: 'import { value } from "../lib/value"; export function A(){ return <p>{value}</p>; }' },
      { path: "src/old.ts", content: "export const old = notDefined;" },
    ], ["src/pages/A.tsx"]);
    expect(verdict.issues.filter(issue => issue.kind === "scope" || issue.kind === "undefined")).toEqual([]);
  });
});

describe("repair scope without blanket access", () => {
  const paths = ["src/pages/Existing.tsx", "src/pages/Other.tsx", "src/components/Layout.tsx", "src/styles.css"];
  const args = { scope: "targeted" as const, targetPaths: [paths[0] ?? ""], neighbourPaths: [paths[2] ?? ""], existingPaths: paths };
  it("admits global layout CSS for a repair", () => {
    expect(buildEditBoundary({ ...args, repair: true }).allows("src/styles.css")).toBe(true);
  });
  it("admits the implicated layout dependency", () => {
    expect(buildEditBoundary({ ...args, repair: true }).allows("src/components/Layout.tsx")).toBe(true);
  });
  it("keeps an unrelated existing page outside a repair", () => {
    expect(buildEditBoundary({ ...args, repair: true }).allows("src/pages/Other.tsx")).toBe(false);
  });
  it("does not expand an ordinary targeted edit", () => {
    expect(buildEditBoundary(args).allows("src/styles.css")).toBe(false);
  });
  it("execution scope agrees about implicated shared layouts", () => {
    const scope = buildExecutionScope({ request: "Fix the overflow", classification: classifyRequest("Fix the overflow", { isInitial: false }), manifest: null, targets: ["src/pages/Existing.tsx"], neighbours: ["src/components/Layout.tsx"], repair: true });
    expect(scope.isProtected("src/components/Layout.tsx")).toBe(false);
    expect(scope.isProtected("src/components/OtherLayout.tsx")).toBe(true);
  });
});

describe("autonomous repair continuity", () => {
  beforeEach(() => { db.written = null; db.previous = { id: "completion", project_id: "p", turn_id: "old", user_id: "u", stage: "repairing", attempts: 1, max_attempts: 3, outstanding_defects: ["horizontal overflow"], defect_fingerprint: fingerprintDefects(["horizontal overflow"]), last_build_id: "build", evidence: ["browser check"], accepted: false }; });
  it("does not count an already-claimed worker attempt twice", async () => {
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "next", isAutoFix: true });
    expect(db.written?.["attempts"]).toBe(1);
  });
  it("counts an unclaimed browser repair once", async () => {
    if (db.previous) db.previous["stage"] = "needs_repair";
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "next", isAutoFix: true });
    expect(db.written?.["attempts"]).toBe(2);
  });
  it("preserves defect identity across automatic turn ids", async () => {
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "next", isAutoFix: true });
    expect(db.written?.["defect_fingerprint"]).toBe(fingerprintDefects(["horizontal overflow"]));
    expect(db.written?.["outstanding_defects"]).toEqual(["horizontal overflow"]);
  });
  it("stops an unchanged failed repair instead of queuing another", async () => {
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "next", isAutoFix: true });
    db.previous = { ...db.previous, ...db.written, id: "next-completion" };
    await recordBuildOutcome({ projectId: "p", buildId: "new-build", shipped: true, blockingDefects: ["horizontal overflow"] });
    expect(db.written?.["stage"]).toBe("blocked");
  });
  it("does not reset attempts when attaching to the same automatic turn", async () => {
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "old", isAutoFix: true });
    expect(db.written?.["attempts"]).toBe(1);
  });
  it("allows another attempt when the remaining defect actually changes", async () => {
    await recordBuildOutcome({ projectId: "p", buildId: "new-build", shipped: true, blockingDefects: ["missing import"] });
    expect(db.written?.["stage"]).toBe("needs_repair");
  });
  it("starts a new user request with fresh repair history", async () => {
    await openTurnCompletion({ projectId: "p", userId: "u", turnId: "next" });
    expect(db.written?.["attempts"]).toBe(0);
    expect(db.written?.["defect_fingerprint"]).toBeNull();
  });
});