/**
 * One-time referral payout, run when a waitlist member first signs in.
 *
 * Runs on every sign-in (cheap, idempotent):
 *  - stamps first_signin_at + activates the referral they came from
 *  - pays the friend their welcome credits
 *  - pays out any of *their own* referrals that have since activated
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  REFERRER_CREDITS,
  REFERRED_CREDITS,
  REWARDED_REFERRALS_CAP,
} from "@/lib/referral";

export const claimWaitlistReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | null)?.email?.toLowerCase();
    if (!email) return { claimed: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("waitlist_signups" as never)
      .select("id, first_signin_at")
      .eq("email", email)
      .maybeSingle();
    const me = row as { id: string; first_signin_at: string | null } | null;
    if (!me) return { claimed: false as const };

    let welcomeCredits = 0;

    if (!me.first_signin_at) {
      await supabaseAdmin
        .from("waitlist_signups" as never)
        .update({ first_signin_at: new Date().toISOString() } as never)
        .eq("id", me.id);

      // Activate the referral that brought them here + pay their welcome credits.
      const { data: edge } = await supabaseAdmin
        .from("waitlist_referrals" as never)
        .select("id, referred_credited_at")
        .eq("referred_id", me.id)
        .maybeSingle();
      const referral = edge as { id: string; referred_credited_at: string | null } | null;

      if (referral && !referral.referred_credited_at) {
        const { error } = await supabaseAdmin.rpc("admin_grant_credit" as never, {
          _target_user_id: context.userId,
          _amount: REFERRED_CREDITS,
          _note: "Referral welcome bonus",
        } as never);
        if (!error) {
          welcomeCredits = REFERRED_CREDITS;
          await supabaseAdmin
            .from("waitlist_referrals" as never)
            .update({
              status: "activated",
              activated_at: new Date().toISOString(),
              referred_credited_at: new Date().toISOString(),
            } as never)
            .eq("id", referral.id);
        }
      }
    }

    // Pay out my own activated referrals that haven't been credited yet.
    const { data: pendingRows } = await supabaseAdmin
      .from("waitlist_referrals" as never)
      .select("id")
      .eq("referrer_id", me.id)
      .not("activated_at", "is", null)
      .is("referrer_credited_at", null)
      .limit(REWARDED_REFERRALS_CAP);
    const pending = (pendingRows ?? []) as { id: string }[];

    let earned = 0;
    if (pending.length > 0) {
      const { error } = await supabaseAdmin.rpc("admin_grant_credit" as never, {
        _target_user_id: context.userId,
        _amount: pending.length * REFERRER_CREDITS,
        _note: `Referral reward — ${pending.length} friend${pending.length === 1 ? "" : "s"}`,
      } as never);
      if (!error) {
        earned = pending.length * REFERRER_CREDITS;
        await supabaseAdmin
          .from("waitlist_referrals" as never)
          .update({ referrer_credited_at: new Date().toISOString() } as never)
          .in(
            "id",
            pending.map((p) => p.id),
          );
      }
    }

    return { claimed: true as const, welcomeCredits, earned };
  });
