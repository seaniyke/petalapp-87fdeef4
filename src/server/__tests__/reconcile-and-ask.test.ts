import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveRequirements,
  evaluateRequirements,
  stageForTurn,
  type PrdRequirement,
} from "@/server/prd/prd-requirements";
import { buildEvidenceFromRow, evidenceFromFiles } from "@/server/prd/prd-progress.server";
import { attachRequirements } from "@/server/prd/prd-engine.server";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import {
  decideAskPolicy,
  noAskInstruction,
  resolveTriageMode,
  SENIOR_ENGINEER_POSTURE,
} from "@/server/ask-policy.server";

const HOTEL =
  "Build me a premium hotel booking platform with Home, Rooms, Room details, Booking, Customer accounts, Stripe payments, Admin dashboard, Bookings management, Email notifications, Responsive design and Analytics.";

const FILES = [
  { path: "src/App.tsx", content: `<Route path="/" /><Route path="/rooms" /><Route path="/rooms/:id" /><Route path="/booking" /><Route path="/login" />` },
  { path: "src/pages/Home.tsx", content: "home" },
  { path: "src/pages/Rooms.tsx", content: "rooms" },
  { path: "src/pages/RoomDetail.tsx", content: "detail" },
  { path: "src/pages/Booking.tsx", content: "booking" },
  { path: "src/pages/Login.tsx", content: "auth" },
];
const REV = 7;
const readyRow = (rev = REV) => ({ status: "ready", project_revision: rev, verification: { ok: true, defects: [] } });
const st = (r: PrdRequirement[], id: string) => r.find((x) => x.id === id)!.status;

/** Same path the engine takes for an existing project: reconcile against the current build row. */
function reconcile(reqs: PrdRequirement[], files = FILES, row: any = readyRow(), rev = REV) {
  return evaluateRequirements(reqs, evidenceFromFiles(files, rev, buildEvidenceFromRow(row, rev), []));
}

describe("existing-project reconciliation", () => {
  const fresh = deriveRequirements(HOTEL);

  it("A: previously verified requirements keep their status", () => {
    const first = reconcile(fresh);
    expect(st(first, "catalog")).toBe("COMPLETED");
    const again = reconcile(first, FILES, { status: "building", project_revision: REV, verification: null });
    expect(st(again, "catalog")).toBe("COMPLETED");
    expect(st(again, "booking")).toBe("COMPLETED");
  });

  it("legacy project (no stored statuses) is reconciled from its current verified build, not reset", () => {
    const r = reconcile(fresh);
    for (const id of ["home", "catalog", "detail", "booking", "auth"]) expect(st(r, id)).toBe("COMPLETED");
    for (const id of ["admin", "management", "analytics"]) expect(st(r, id)).toBe("NOT_STARTED");
  });

  it("B: matching files without authoritative verification never become COMPLETED", () => {
    const noBuild = reconcile(fresh, FILES, null);
    const unverified = reconcile(fresh, FILES, { status: "ready", project_revision: REV, verification: null });
    const failed = reconcile(fresh, FILES, { status: "failed", project_revision: REV, verification: { ok: false } });
    for (const r of [noBuild, unverified, failed]) {
      expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
      expect(st(r, "catalog")).toBe("IN_PROGRESS");
    }
  });

  it("C: a stale verified build (older revision) does not complete anything", () => {
    const r = reconcile(fresh, FILES, readyRow(REV - 1));
    expect(buildEvidenceFromRow(readyRow(REV - 1), REV)!.status).toBe("stale");
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });

  it("C: a completion whose files changed after verification does not stay COMPLETED", () => {
    const done = reconcile(fresh);
    const changed = FILES.map((f) => (f.path.endsWith("Rooms.tsx") ? { ...f, content: "rooms v2" } : f));
    const r = reconcile(done, changed, readyRow(REV), REV + 1); // build row now stale
    expect(st(r, "catalog")).toBe("IN_PROGRESS");
  });

  it("D: an existing project continues from its actual state", () => {
    const prd = { ...deterministicPrd(HOTEL), requirements: reconcile(fresh) };
    const stored = { prd, revision: 3, updatedAt: "", sourcePrompt: HOTEL };
    const next = attachRequirements(prd, "Continue", stored).prd.requirements!;
    const { mode, stage } = stageForTurn(next, "Continue", false);
    expect(mode).toBe("continue");
    const ids = stage.map((s) => s.id);
    expect(ids).toContain("admin");
    expect(ids).not.toContain("catalog");
    expect(ids).not.toContain("home");
  });

  it("E: re-running reconciliation on unchanged state is identical (same objects, same timestamps)", () => {
    const once = reconcile(fresh);
    const twice = reconcile(once);
    expect(twice).toEqual(once);
    twice.forEach((r, i) => expect(r).toBe(once[i]));
    const idle = reconcile(fresh, FILES, null);
    const idle2 = reconcile(idle, FILES, null);
    idle2.forEach((r, i) => expect(r).toBe(idle[i]));
  });

  it("F: a changed implementation invalidates only the affected requirement", () => {
    const done = reconcile(fresh);
    const changed = FILES.map((f) => (f.path.endsWith("Booking.tsx") ? { ...f, content: "booking v2" } : f));
    const r = reconcile(done, changed, null, REV + 1);
    expect(st(r, "booking")).toBe("IN_PROGRESS");
    for (const id of ["home", "catalog", "detail", "auth"]) expect(st(r, id)).toBe("COMPLETED");
  });
});

describe("ask policy — should NOT ask", () => {
  const cases = [
    "Build me a premium hotel booking platform with rooms, booking, customer accounts, Stripe, admin dashboard and notifications.",
    "Add a pricing page.",
    "Make the checkout feel more premium.",
    "Add an admin dashboard.",
    "Continue building the remaining platform.",
    "Change the button colour and the font.",
  ];
  for (const text of cases) {
    it(`acts on: ${text}`, () => {
      const policy = decideAskPolicy(text);
      expect(policy.forceAction).toBe(true);
      // Even if the model proposes a question, the turn builds/edits.
      expect(resolveTriageMode("clarify", policy, 0)).toEqual({ mode: "build", clarifyBlocked: true });
      expect(resolveTriageMode("clarify", policy, 12)).toEqual({ mode: "edit", clarifyBlocked: true });
      expect(noAskInstruction(policy.reason)).toMatch(/MUST NOT be "clarify"/);
    });
  }

  it("posture covers colours, typography, spacing, layout, naming and defaults", () => {
    for (const w of ["naming", "colours", "layout", "spacing", "sample content"]) expect(SENIOR_ENGINEER_POSTURE).toContain(w);
  });
});

describe("ask policy — SHOULD ask, then resume", () => {
  // Fundamentally ambiguous: no product, no action — could be a shop, a
  // booking site, a portfolio or an internal tool.
  const AMBIGUOUS = "something for my business";

  it("a materially ambiguous request may clarify", () => {
    const policy = decideAskPolicy(AMBIGUOUS);
    expect(policy.forceAction).toBe(false);
    expect(resolveTriageMode("clarify", policy, 0)).toEqual({ mode: "clarify", clarifyBlocked: false });
  });

  it("the clarifying question is one focused question with quick answers", () => {
    const triage = readFileSync("src/routes/api/triage.ts", "utf8");
    expect(triage).toMatch(/ask ONE focused question/);
    expect(triage).toMatch(/Never ask two questions/);
    expect(triage).toMatch(/When mode = "clarify", suggestions MUST be non-empty \(2–4 chips\)/);
  });

  it("the answer resumes building immediately and never asks again", () => {
    const history = [
      { role: "user", content: AMBIGUOUS },
      { role: "assistant", content: "Happy to — what does your business do?" },
    ];
    const policy = decideAskPolicy("I run a small bakery", history);
    expect(policy).toEqual({ forceAction: true, reason: "answering-a-question" });
    expect(resolveTriageMode("clarify", policy, 0).mode).toBe("build");
    expect(noAskInstruction(policy.reason)).toMatch(/never ask again immediately/);
  });

  it("waiting for an answer writes no files and charges nothing", () => {
    const triage = readFileSync("src/routes/api/triage.ts", "utf8");
    expect(triage).not.toMatch(/replace_project_files|replaceFiles|from\("project_files"\)\s*\.(insert|update|upsert|delete)/);
    expect(triage).not.toMatch(/spend_credit|chargeCredits|chargeRuntime/);
  });

  it("the answer joins the same product context — PRD requirements are preserved", () => {
    const prd = { ...deterministicPrd(HOTEL), requirements: deriveRequirements(HOTEL).map((r) => (r.id === "catalog" ? { ...r, status: "COMPLETED" as const } : r)) };
    const stored = { prd, revision: 2, updatedAt: "", sourcePrompt: HOTEL };
    const out = attachRequirements(prd, "Guests should pay a deposit only", stored).prd.requirements!;
    expect(out.length).toBeGreaterThanOrEqual(prd.requirements.length);
    expect(out.find((r) => r.id === "catalog")!.status).toBe("COMPLETED");
  });
});
