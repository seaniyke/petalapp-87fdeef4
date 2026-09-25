import { describe, expect, it } from "vitest";
import {
  continuationSuggestions,
  deriveRequirements,
  evaluateRequirements,
  hashContent,
  mergeRequirements,
  renderProgressSummary,
  renderRequirementsBlock,
  requirementsTargetedBy,
  selectNextStage,
  stageForTurn,
  type PrdRequirement,
  type RequirementEvidence,
} from "@/server/prd/prd-requirements";
import { attachRequirements } from "@/server/prd/prd-engine.server";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { amendPrd } from "@/server/prd/prd-amend";
import { planProductStage } from "@/server/engine/plan";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_PATCH } from "@/server/generate.server";
import { archetypeBuildInstruction, archetypeRoadmapBlock, detectArchetype, getArchetype } from "@/lib/project-archetype";
import { routesFromFiles, integrationsFromSecretNames } from "@/server/prd/prd-progress.server";

const HOTEL =
  "Build me a premium hotel booking platform with Home, Rooms, Room details, Booking, Customer accounts, Stripe payments, Admin dashboard, Bookings management, Email notifications, Responsive design and Analytics.";

const ids = (r: PrdRequirement[]) => r.map((x) => x.id);

function files(paths: Record<string, string>) {
  return Object.entries(paths).map(([path, content]) => ({ path, hash: hashContent(content) }));
}

const STAGE1: Record<string, string> = {
  "src/App.tsx": "routes",
  "src/pages/Home.tsx": "home",
  "src/pages/Rooms.tsx": "rooms",
  "src/pages/RoomDetail.tsx": "detail",
  "src/pages/Booking.tsx": "booking",
  "src/pages/Login.tsx": "auth",
};
const STAGE1_ROUTES = ["/", "/rooms", "/rooms/:id", "/booking", "/login"];

function ev(over: Partial<RequirementEvidence> = {}, f = STAGE1, routes = STAGE1_ROUTES): RequirementEvidence {
  return { projectRevision: 5, files: files(f), routes, build: null, configuredIntegrations: [], ...over };
}
const READY = (rev = 5, phone = true) => ({ revision: rev, status: "ready" as const, verified: true, phoneChecked: phone });

describe("A/B — whole scope retained, no reduction to intent #1", () => {
  it("A: hotel brief yields every named requirement", () => {
    const r = deriveRequirements(HOTEL);
    expect(ids(r)).toEqual(
      expect.arrayContaining(["home", "catalog", "detail", "booking", "auth", "payments", "admin", "management", "notifications", "responsive", "analytics"]),
    );
    expect(r).toHaveLength(11);
  });
  it("B: curtailment rules are gone from every prompt", () => {
    for (const p of [SYSTEM_PROMPT, SYSTEM_PROMPT_PATCH]) {
      expect(p).not.toMatch(/ONLY the first one|tackled #1/);
      expect(p).toMatch(/requested product scope is authoritative/);
    }
    const a = getArchetype(detectArchetype(HOTEL).id ?? "saas");
    for (const b of [archetypeBuildInstruction(a), archetypeRoadmapBlock(a)]) {
      expect(b).not.toMatch(/DO NOT build the in-app product|landing page first|in-product surfaces only when/i);
      expect(b).toMatch(/requested product scope is authoritative/);
    }
  });
  it("dependencies order foundations first", () => {
    const r = ids(deriveRequirements(HOTEL));
    expect(r.indexOf("catalog")).toBeLessThan(r.indexOf("booking"));
    expect(r.indexOf("booking")).toBeLessThan(r.indexOf("payments"));
    expect(r.indexOf("admin")).toBeLessThan(r.indexOf("management"));
    expect(r.indexOf("auth")).toBeLessThan(r.indexOf("admin"));
  });
});

describe("C/K — persistence across turns", () => {
  const prd = attachRequirements(deterministicPrd(HOTEL), HOTEL, null).prd;
  const stored = { prd, revision: 1, updatedAt: "", sourcePrompt: HOTEL };
  it("C: a later turn keeps the full list and statuses", () => {
    const withStatus = { ...stored, prd: { ...prd, requirements: prd.requirements!.map((r) => (r.id === "catalog" ? { ...r, status: "COMPLETED" as const } : r)) } };
    const next = attachRequirements(withStatus.prd, "Continue", withStatus).prd.requirements!;
    expect(next).toHaveLength(11);
    expect(next.find((r) => r.id === "catalog")!.status).toBe("COMPLETED");
  });
  it("K: styling-only iteration does not reset functional requirements", () => {
    const brief = "Make the booking experience more premium with softer colours";
    const amended = amendPrd(prd, brief);
    const out = attachRequirements(amended.prd, brief, stored);
    expect(out.prd.requirements!.map((r) => r.status)).toEqual(prd.requirements!.map((r) => r.status));
  });
  it("old PRDs without requirements are derived from the stored prompt", () => {
    const { requirements, ...legacy } = prd;
    void requirements;
    const out = attachRequirements(legacy as typeof prd, "Continue", { ...stored, prd: legacy as typeof prd });
    expect(out.prd.requirements).toHaveLength(11);
    expect(out.changed).toBe(true);
  });
});

describe("D–H, O–Q — status only from authoritative evidence", () => {
  const base = deriveRequirements(HOTEL);
  const st = (r: PrdRequirement[], id: string) => r.find((x) => x.id === id)!.status;

  it("D: source files alone never complete a requirement", () => {
    const r = evaluateRequirements(base, ev());
    expect(st(r, "catalog")).toBe("IN_PROGRESS");
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });
  it("E: a failed build completes nothing", () => {
    const r = evaluateRequirements(base, ev({ build: { revision: 5, status: "failed", verified: false } }));
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });
  it("F: a stale build (older revision) completes nothing", () => {
    const r = evaluateRequirements(base, ev({ build: READY(4) }));
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });
  it("unverified ready build completes nothing", () => {
    const r = evaluateRequirements(base, ev({ build: { revision: 5, status: "ready", verified: false } }));
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });
  it("G: a verified current build completes what exists, not what doesn't", () => {
    const r = evaluateRequirements(base, ev({ build: READY() }));
    for (const id of ["home", "catalog", "detail", "booking", "auth", "responsive"]) expect(st(r, id)).toBe("COMPLETED");
    for (const id of ["admin", "management", "analytics"]) expect(st(r, id)).toBe("NOT_STARTED");
    expect(r.find((x) => x.id === "catalog")!.lastVerifiedRevision).toBe(5);
  });
  it("responsive needs a phone-width check", () => {
    const r = evaluateRequirements(base, ev({ build: READY(5, false) }));
    expect(st(r, "responsive")).not.toBe("COMPLETED");
  });
  it("H: an external integration without an account stays BLOCKED", () => {
    const f = { ...STAGE1, "src/pages/Checkout.tsx": "stripe checkout", "src/lib/email.ts": "send" };
    const r = evaluateRequirements(base, ev({ build: READY() }, f));
    expect(st(r, "payments")).toBe("BLOCKED");
    expect(st(r, "notifications")).toBe("BLOCKED");
    const r2 = evaluateRequirements(base, ev({ build: READY(), configuredIntegrations: ["stripe"] }, f));
    expect(st(r2, "payments")).toBe("COMPLETED");
  });
  it("O: cancellation completes nothing", () => {
    const r = evaluateRequirements(base, ev({ build: { revision: 5, status: "cancelled", verified: false } }));
    expect(r.some((x) => x.status === "COMPLETED")).toBe(false);
  });
  it("Q: completion at N stays valid at N+1 when its files are unchanged", () => {
    const done = evaluateRequirements(base, ev({ build: READY() }));
    const later = evaluateRequirements(done, ev({ projectRevision: 6, build: null }, { ...STAGE1, "src/pages/Admin.tsx": "admin" }, [...STAGE1_ROUTES, "/admin"]));
    expect(st(later, "catalog")).toBe("COMPLETED");
    expect(st(later, "admin")).toBe("IN_PROGRESS");
  });
  it("P: changing a requirement's files invalidates its completion until re-verified", () => {
    const done = evaluateRequirements(base, ev({ build: READY() }));
    const later = evaluateRequirements(done, ev({ projectRevision: 6 }, { ...STAGE1, "src/pages/Rooms.tsx": "rooms v2" }));
    expect(st(later, "catalog")).toBe("IN_PROGRESS");
    expect(st(later, "home")).toBe("COMPLETED");
    const removed = { ...STAGE1 };
    delete (removed as Record<string, string>)["src/pages/Booking.tsx"];
    const gone = evaluateRequirements(done, ev({ projectRevision: 6 }, removed, STAGE1_ROUTES.filter((r) => r !== "/booking")));
    expect(st(gone, "booking")).toBe("NOT_STARTED");
  });
});

describe("I/J/R — stages and continuation from real state", () => {
  const base = deriveRequirements(HOTEL);
  const stage1 = evaluateRequirements(base, ev({ build: READY() }));

  it("first build picks a coherent bounded foundation", () => {
    const s = ids(selectNextStage(base));
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s).toEqual(expect.arrayContaining(["home", "catalog"]));
    expect(s).not.toContain("management");
    expect(s).not.toContain("analytics");
  });
  it("I: 'Continue' selects meaningful remaining work", () => {
    const { mode, stage } = planProductStage(stage1, "Continue", false);
    expect(mode).toBe("continue");
    expect(ids(stage)).toEqual(expect.arrayContaining(["admin"]));
    expect(ids(stage)).not.toContain("catalog");
  });
  it("J/R: suggestions reflect remaining requirements, never 'Try again'", () => {
    const s = continuationSuggestions(stage1);
    expect(s).toContain("Build the admin dashboard");
    expect(s).toContain("Continue building the remaining platform");
    expect(s.join(" ")).not.toMatch(/try again/i);
  });
  it("no suggestions when nothing remains", () => {
    const all = base.map((r) => ({ ...r, status: "COMPLETED" as const }));
    expect(continuationSuggestions(all)).toEqual([]);
  });
  it("targeted 'Add Stripe' focuses on payments only", () => {
    const { mode, stage } = stageForTurn(stage1, "Add Stripe", false);
    expect(mode).toBe("targeted");
    expect(ids(stage)).toEqual(["payments"]);
  });
  it("L: repair request stays scoped to the affected feature", () => {
    expect(ids(requirementsTargetedBy(stage1, "The checkout is broken"))).toEqual(["payments"].filter((id) => ids(stage1).includes(id)).length ? ids(requirementsTargetedBy(stage1, "The checkout is broken")) : []);
    const { stage } = stageForTurn(stage1, "The booking confirmation email isn't working", false);
    expect(ids(stage)).not.toContain("admin");
    expect(ids(stage)).not.toContain("catalog");
  });
  it("styling request is scoped and says not to regenerate", () => {
    const plan = stageForTurn(stage1, "Make it feel warmer", false);
    expect(plan.mode).toBe("scoped");
    expect(renderRequirementsBlock(stage1, plan)).toMatch(/Do not rebuild or regenerate/);
  });
  it("summary tells the truth about what remains", () => {
    const text = renderProgressSummary(stage1, "The Gilded");
    expect(text).toMatch(/6\/11 requirements verified/);
    expect(text).toMatch(/Remaining: .*Admin dashboard/);
    expect(text).not.toMatch(/complete!/i);
  });
  it("prompt block retains every requirement and forbids 'complete' claims", () => {
    const block = renderRequirementsBlock(base, stageForTurn(base, HOTEL, true));
    for (const r of base) expect(block).toContain(r.id);
    expect(block).toMatch(/never call the product complete/);
  });
});

describe("M/N — ask-policy unchanged", () => {
  it("M: build prompts still forbid unnecessary questions", () => {
    expect(SYSTEM_PROMPT).toMatch(/DO NOT ASK THE USER QUESTIONS IN THIS TURN/);
    expect(SYSTEM_PROMPT_PATCH).toMatch(/DO NOT ASK THE USER QUESTIONS IN THIS TURN/);
  });
});

describe("merge and evidence helpers", () => {
  it("adding a new feature appends without resetting", () => {
    const base = deriveRequirements(HOTEL).map((r) => ({ ...r, status: "COMPLETED" as const }));
    const out = mergeRequirements(base, "Add a blog");
    expect(out.added).toEqual(["blog"]);
    expect(out.requirements.filter((r) => r.status === "COMPLETED")).toHaveLength(11);
  });
  it("removal marks REJECTED rather than deleting", () => {
    const out = mergeRequirements(deriveRequirements(HOTEL), "Remove analytics");
    expect(out.requirements.find((r) => r.id === "analytics")!.status).toBe("REJECTED");
  });
  it("routes and integrations are read from real project state", () => {
    expect(routesFromFiles([{ path: "src/App.tsx", content: `<Route path="/rooms" /><Route path='/rooms/:id' />` }])).toEqual(["/rooms", "/rooms/:id"]);
    expect(integrationsFromSecretNames(["STRIPE_SECRET_KEY", "RESEND_API_KEY"])).toEqual(["stripe", "email"]);
  });
});
