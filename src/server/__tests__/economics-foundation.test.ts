import { describe, expect, it } from "vitest";
import { decideBuildOutcome, type OutcomeInput } from "@/lib/build-outcome";
import { aiRowToCostEvent, classifyTurnCalls, normaliseCost, toRow } from "@/server/cost-events.server";
import { mapBounded, PAGE_CONCURRENCY } from "@/server/engine/write";

const base: OutcomeInput = {
  existingStatus: "building",
  incoming: "failed",
  buildRevision: 2,
  projectRevision: 2,
  siblingReadyForRevision: false,
};

describe("Gilded Shingle race: success is never downgraded or refunded", () => {
  it("SUCCESS → late FAILED callback", () => {
    const d = decideBuildOutcome({ ...base, existingStatus: "ready", errorMessage: "callback timed out" });
    expect(d.apply).toBe(false);
    expect(d.refundAllowed).toBe(false);
  });
  it("SUCCESS → duplicate FAILED callback (twice)", () => {
    for (let i = 0; i < 2; i++) {
      const d = decideBuildOutcome({ ...base, existingStatus: "ready" });
      expect([d.apply, d.refundAllowed]).toEqual([false, false]);
    }
  });
  it("SUCCESS → out-of-order FAILED on a sibling build of the same revision", () => {
    const d = decideBuildOutcome({ ...base, siblingReadyForRevision: true });
    expect(d.refundAllowed).toBe(false);
    expect(d.affectsReadiness).toBe(false);
  });
  it("FAILED → later SUCCESS is accepted", () => {
    const d = decideBuildOutcome({ ...base, existingStatus: "failed", incoming: "ready" });
    expect(d.apply).toBe(true);
    expect(d.affectsReadiness).toBe(true);
  });
  it("READY → stale build failure", () => {
    const d = decideBuildOutcome({ ...base, existingStatus: "ready", buildRevision: 1, projectRevision: 3 });
    expect(d.refundAllowed).toBe(false);
  });
  it("READY → stale browser failure after deploy", () => {
    const d = decideBuildOutcome({ ...base, deployed: true, errorMessage: "flow 'Book Now' not found" });
    expect(d.failureClass).toBe("verification");
    expect(d.refundAllowed).toBe(false);
  });
  it("new revision → old build failure never refunds or touches readiness", () => {
    const d = decideBuildOutcome({ ...base, buildRevision: 1, projectRevision: 2 });
    expect(d.refundAllowed).toBe(false);
    expect(d.affectsReadiness).toBe(false);
    expect(d.failureClass).toBe("stale");
  });
  it("two competing callbacks: first ready wins, second failed ignored", () => {
    const first = decideBuildOutcome({ ...base, incoming: "ready" });
    expect(first.apply).toBe(true);
    const second = decideBuildOutcome({ ...base, existingStatus: "ready" });
    expect(second.apply).toBe(false);
  });
  it("duplicate ready is a no-op", () => {
    expect(decideBuildOutcome({ ...base, existingStatus: "ready", incoming: "ready" }).apply).toBe(false);
  });
  it("refund attempted after authoritative READY is refused", () => {
    expect(decideBuildOutcome({ ...base, existingStatus: "ready" }).refundAllowed).toBe(false);
  });
  it("infrastructure timeout after deploy is not a customer failure", () => {
    const d = decideBuildOutcome({ ...base, deployed: true, errorMessage: "ETIMEDOUT delivering callback" });
    expect(d.failureClass).toBe("infrastructure");
    expect(d.refundAllowed).toBe(false);
  });
  it("a real source failure on the current revision still refunds", () => {
    const d = decideBuildOutcome({ ...base, errorMessage: "tsc: Cannot find module './Rooms'" });
    expect(d.failureClass).toBe("source");
    expect(d.refundAllowed).toBe(true);
  });
});

describe("cost ledger honesty", () => {
  it("OpenRouter-reported cost is ACTUAL", () => {
    const e = aiRowToCostEvent({ id: "a", user_id: null, project_id: null, turn_id: "t", stage: "write", model: "m", upstream_provider: "Azure", provider: "openrouter", prompt_tokens: 10, completion_tokens: 5, cost_usd_micro: 3690, cost_basis: "actual", status: 200 });
    expect(e.basis).toBe("ACTUAL");
    expect(e.costUsd).toBeCloseTo(0.00369);
    expect(e.category).toBe("AI_INFERENCE");
  });
  it("missing cost stays UNKNOWN with null, never $0", () => {
    const e = aiRowToCostEvent({ id: "b", user_id: null, project_id: null, turn_id: "t", stage: "verify", model: "m", upstream_provider: null, provider: null, prompt_tokens: 1, completion_tokens: 1, cost_usd_micro: null, cost_basis: null, status: 200 });
    expect(e.basis).toBe("UNKNOWN");
    expect(toRow(e).cost_usd).toBeNull();
    expect(e.category).toBe("AI_VERIFICATION");
  });
  it("estimated / allocated remain distinct from actual", () => {
    expect(normaliseCost({ costUsd: 0.1, basis: "ESTIMATED" }).basis).toBe("ESTIMATED");
    expect(normaliseCost({ costUsd: 0.1, basis: "ALLOCATED" }).basis).toBe("ALLOCATED");
    expect(normaliseCost({ costUsd: 0.1, basis: "UNKNOWN" })).toEqual({ costUsd: null, basis: "UNKNOWN" });
  });
  it("failed calls are marked failed work (cost kept)", () => {
    const e = aiRowToCostEvent({ id: "c", user_id: null, project_id: null, turn_id: "t", stage: "write", model: "m", upstream_provider: null, provider: null, prompt_tokens: 1, completion_tokens: 0, cost_usd_micro: 100, cost_basis: "actual", status: 502 });
    expect(e.failedWork).toBe(true);
    expect(e.costUsd).not.toBeNull();
  });
  it("the Gilded Shingle duplicate request-understanding call is REDUNDANT", () => {
    const c = classifyTurnCalls([
      { stage: "request", purpose: "classify", call_kind: "check" },
      { stage: "plan", purpose: "design", call_kind: "normal" },
      { stage: "request", purpose: "classify", call_kind: "check" },
      { stage: "write", purpose: "write one requested page (or the router)", call_kind: "normal" },
      { stage: "write", purpose: "resend", call_kind: "retry" },
      { stage: "verify", purpose: "plan browser checks", call_kind: "check" },
    ]);
    expect(c).toEqual(["REQUIRED", "REQUIRED", "REDUNDANT", "REQUIRED", "RETRY", "VERIFICATION"]);
  });
});

describe("page fan-out stays on the warm cache", () => {
  it("never runs more than PAGE_CONCURRENCY calls at once and preserves order", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5, 6], PAGE_CONCURRENCY, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return n * 2;
    });
    expect(peak).toBe(PAGE_CONCURRENCY);
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
  });
});
