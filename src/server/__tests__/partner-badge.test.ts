import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { partnerBadgeRemovalCredits, PARTNER_BADGE_REMOVAL_USD } from "@/server/partner-badge.server";

describe("partner badge removal price", () => {
  it("costs the partner $2.00", () => {
    expect(PARTNER_BADGE_REMOVAL_USD).toBe(2);
  });
  it("charges 13.34 credits at 15¢ a credit (never under $2)", () => {
    expect(partnerBadgeRemovalCredits()).toBe(13.34);
    expect(partnerBadgeRemovalCredits() * 0.15).toBeGreaterThanOrEqual(2);
  });
});
