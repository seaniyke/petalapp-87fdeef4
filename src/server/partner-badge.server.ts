/**
 * Partner (Custard AI) badge removal.
 *
 * Custard removes the "Powered by Custard AI" badge from one project for a
 * fixed $2.00, paid once from the partner account's Petal credits. Custard
 * resells it at its own price. After payment the live site is shipped again
 * without the badge.
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** What Petal charges the partner for removing the badge, in USD. */
export const PARTNER_BADGE_REMOVAL_USD = 2;
/** One credit is worth 15¢ for fixed-price partner purchases. */
export const PARTNER_USD_PER_CREDIT = 0.15;

/** $2.00 → credits, rounded up to 0.01 so Petal never takes less than $2. */
export function partnerBadgeRemovalCredits(): number {
  return Math.ceil((PARTNER_BADGE_REMOVAL_USD / PARTNER_USD_PER_CREDIT) * 100 - 1e-9) / 100;
}

export async function badgeRemovalStatus(projectId: string): Promise<{ removed: boolean }> {
  const { data } = await supabaseAdmin
    .from("project_badge_removals" as never)
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();
  return { removed: !!data };
}

export type BadgeRemovalResult =
  | { ok: true; alreadyRemoved: boolean; credits: number; usd: number }
  | { ok: false; status: number; error: string };

/** Charge once and record the removal. Idempotent per project. */
export async function removePartnerBadge(projectId: string, partnerUserId: string): Promise<BadgeRemovalResult> {
  const credits = partnerBadgeRemovalCredits();
  if ((await badgeRemovalStatus(projectId)).removed) {
    await supabaseAdmin.from("projects").update({ hide_petal_badge: true }).eq("id", projectId);
    return { ok: true, alreadyRemoved: true, credits: 0, usd: 0 };
  }
  const { spendCredit, refundCredit } = await import("@/server/credits.server");
  const spent = await spendCredit({
    userId: partnerUserId,
    amount: credits,
    reason: "badge_removal" as never,
    projectId,
    metadata: { kind: "badge_removal", partner: "custard", usd: PARTNER_BADGE_REMOVAL_USD },
  });
  if (!spent.ok) {
    return spent.reason === "insufficient_credits"
      ? { ok: false, status: 402, error: "insufficient_credits" }
      : { ok: false, status: 500, error: "charge_failed" };
  }
  const { error } = await supabaseAdmin
    .from("project_badge_removals" as never)
    .insert({ project_id: projectId, user_id: partnerUserId, ledger_id: spent.ledgerId, credits } as never);
  if (error) {
    // Lost a race to a parallel call: give this charge back.
    await refundCredit({ userId: partnerUserId, ledgerId: spent.ledgerId, reason: "refund" });
    if (!(await badgeRemovalStatus(projectId)).removed) return { ok: false, status: 500, error: "record_failed" };
    return { ok: true, alreadyRemoved: true, credits: 0, usd: 0 };
  }
  await supabaseAdmin.from("projects").update({ hide_petal_badge: true }).eq("id", projectId);
  return { ok: true, alreadyRemoved: false, credits, usd: PARTNER_BADGE_REMOVAL_USD };
}
