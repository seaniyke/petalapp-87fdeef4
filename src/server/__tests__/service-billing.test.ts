import { describe, expect, it } from "vitest";
import { buildTurnBill, groupByTurn, summarizeLedger, sumFunding } from "@/server/service-billing.server";
import { parseRange } from "@/server/service-billing-range";

describe("Custard AI billing view", () => {
  it("bills charges, nets refunds, and ignores credits added", () => {
    const s = summarizeLedger([
      { delta: -3.2, reason: "ai_build_charge" },
      { delta: -0.5, reason: "runtime_charge" },
      { delta: -1, reason: "ai_discuss_charge" },
      { delta: -10, reason: "badge_removal" },
      { delta: 1.2, reason: "ai_build_rollback_refund" },
      { delta: 50, reason: "topup" },
    ]);
    expect(s.charged).toBe(14.7);
    expect(s.refunded).toBe(1.2);
    expect(s.net).toBe(13.5);
    expect(s.byCategory).toEqual({ build: 3.2, cloud: 0.5, ai: 1, other: 10 });
  });

  it("a refund reversal takes the refund back", () => {
    const s = summarizeLedger([
      { delta: -2, reason: "ai_build_charge" },
      { delta: 2, reason: "ai_build_rollback_refund" },
      { delta: -2, reason: "duplicate_refund_reversal" },
    ]);
    expect(s.refunded).toBe(0);
    expect(s.net).toBe(2);
  });

  it("counts top-ups and grants as credits added, not charges", () => {
    expect(sumFunding([{ delta: 50, reason: "topup" }, { delta: 1, reason: "ai_build_rollback_refund" }, { delta: -3, reason: "ai_build_charge" }])).toBe(50);
  });

  it("a turn bill carries usage counts but no internal cost", () => {
    const bill = buildTurnBill("t1", [{ delta: -1.5, reason: "ai_build_charge", project_id: "p1" }], {
      project_id: "p1",
      settlement_state: "settled",
      credits_reserved: 5,
      credits_estimated: 2,
      ai_calls: 7,
      prompt_tokens: 1000,
      completion_tokens: 400,
      images_generated: 1,
      models: ["google/gemini-3.8-flash"],
    });
    expect(bill.net).toBe(1.5);
    expect(bill.usage).toEqual({ aiCalls: 7, promptTokens: 1000, completionTokens: 400, imagesGenerated: 1, models: ["google/gemini-3.8-flash"] });
    expect(JSON.stringify(bill)).not.toMatch(/usd/i);
  });

  it("groups ledger rows into per-turn bills", () => {
    const turns = groupByTurn(
      [
        { delta: -1, reason: "ai_build_charge", turn_id: "a" },
        { delta: 0.5, reason: "ai_build_rollback_refund", turn_id: "a" },
        { delta: -2, reason: "ai_build_charge", turn_id: "b" },
        { delta: -0.3, reason: "runtime_charge", turn_id: null },
      ],
      10,
    );
    expect(turns.map((t) => [t.turnId, t.net])).toEqual([["a", 0.5], ["b", 2]]);
  });

  it("rejects bad or reversed date ranges", () => {
    expect(parseRange(new URL("https://x/?from=nope"))).toEqual({ error: "bad_date" });
    expect(parseRange(new URL("https://x/?from=2026-11-05&to=2026-11-01"))).toEqual({ error: "from_must_be_before_to" });
    expect(parseRange(new URL("https://x/?from=2026-11-01&to=2026-11-05"))).toEqual({ from: "2026-11-01T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z" });
  });
});
