import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const spendCredit = vi.fn();
vi.mock("@/server/credits.server", () => ({ spendCredit: (...a: unknown[]) => spendCredit(...a) }));
vi.mock("@/server/economics-config.server", () => ({
  economicsValue: async () => 0.05,
}));

import {
  unifiedBalanceEnabled,
  centsToCredits,
  chargeCreditsForRuntime,
} from "@/server/runtime-credit-fallback.server";

const original = process.env["PETAL_UNIFIED_BALANCE"];

beforeEach(() => {
  spendCredit.mockReset();
  spendCredit.mockResolvedValue({ ok: true, ledgerId: "led_1" });
});
afterEach(() => {
  if (original === undefined) delete process.env["PETAL_UNIFIED_BALANCE"];
  else process.env["PETAL_UNIFIED_BALANCE"] = original;
});

describe("unified balance flag", () => {
  it("is off unless explicitly enabled", () => {
    delete process.env["PETAL_UNIFIED_BALANCE"];
    expect(unifiedBalanceEnabled()).toBe(false);
    for (const v of ["0", "off", "false", "no", "disabled", ""]) {
      process.env["PETAL_UNIFIED_BALANCE"] = v;
      expect(unifiedBalanceEnabled()).toBe(false);
    }
  });
  it("is on for truthy values", () => {
    for (const v of ["1", "on", "true", "YES", "enabled"]) {
      process.env["PETAL_UNIFIED_BALANCE"] = v;
      expect(unifiedBalanceEnabled()).toBe(true);
    }
  });
});

describe("cents to credits", () => {
  it("converts at the configured rate", async () => {
    expect(await centsToCredits(5)).toBeCloseTo(1, 5);
    expect(await centsToCredits(100)).toBeCloseTo(20, 5);
  });
  it("never returns zero for a tiny charge", async () => {
    expect(await centsToCredits(0.01)).toBeGreaterThan(0);
  });
});

describe("chargeCreditsForRuntime", () => {
  it("does nothing while the flag is off", async () => {
    delete process.env["PETAL_UNIFIED_BALANCE"];
    const r = await chargeCreditsForRuntime({ userId: "u", meter: "image_gen", cents: 5 });
    expect(r).toEqual({ handled: false });
    expect(spendCredit).not.toHaveBeenCalled();
  });

  it("charges credits with a traceable ledger reason when enabled", async () => {
    process.env["PETAL_UNIFIED_BALANCE"] = "1";
    const r = await chargeCreditsForRuntime({
      userId: "u",
      projectId: "p",
      meter: "backend_hour",
      cents: 4,
    });
    expect(r).toMatchObject({ handled: true, ok: true, ledgerId: "led_1" });
    const arg = spendCredit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg["reason"]).toBe("runtime_fallback");
    expect((arg["metadata"] as Record<string, unknown>)["runtime_meter"]).toBe("backend_hour");
    expect((arg["metadata"] as Record<string, unknown>)["runtime_cents"]).toBe(4);
  });

  it("reports a failed credit charge instead of silently passing", async () => {
    process.env["PETAL_UNIFIED_BALANCE"] = "1";
    spendCredit.mockResolvedValue({ ok: false, reason: "insufficient_credits" });
    const r = await chargeCreditsForRuntime({ userId: "u", meter: "image_gen", cents: 5 });
    expect(r).toMatchObject({ handled: true, ok: false });
  });

  it("falls back to no-op if anything throws", async () => {
    process.env["PETAL_UNIFIED_BALANCE"] = "1";
    spendCredit.mockRejectedValue(new Error("boom"));
    const r = await chargeCreditsForRuntime({ userId: "u", meter: "image_gen", cents: 5 });
    expect(r).toEqual({ handled: false });
  });
});
