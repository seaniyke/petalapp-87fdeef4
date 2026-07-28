/**
 * Referral plumbing for signed-in users.
 *
 *  - claimWaitlistReferral: runs on every sign-in (cheap, idempotent).
 *      * makes sure the signed-in user has a waitlist row (so referrals work
 *        even when waitlist mode is off and people sign up directly)
 *      * attributes the referral code they arrived with
 *      * stamps first_signin_at, activates the referral, pays both sides
 *  - getMyReferral: the invite surface — code, link stats, credits earned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  REFERRER_CREDITS,
  REFERRED_CREDITS,
  REWARDED_REFERRALS_CAP,
} from "@/lib/referral";

export const claimWaitlistReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ ref: z.string().trim().max(32).optional() })
      .catch({ })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    const claims = context.claims as
      | { email?: string; user_metadata?: { full_name?: string; name?: string } }
      | null;
    const email = claims?.email?.toLowerCase();
    if (!email) return { claimed: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("waitlist_signups" as never)
      .select("id, first_signin_at")
      .eq("email", email)
      .maybeSingle();
    let me = row as { id: string; first_signin_at: string | null } | null;

    // No waitlist row (direct sign-up, or waitlist mode off) — create one so
    // every account is part of the referral graph.
    if (!me) {
      const displayName =
        claims?.user_metadata?.full_name ||
        claims?.user_metadata?.name ||
        email.split("@")[0];

      let referrerId: string | null = null;
      if (data.ref) {
        const { data: refRow } = await supabaseAdmin
          .from("waitlist_signups" as never)
          .select("id, email")
          .eq("referral_code", data.ref.toLowerCase())
          .maybeSingle();
        const candidate = refRow as { id: string; email: string } | null;
        if (candidate && candidate.email.toLowerCase() !== email) referrerId = candidate.id;
      }

      const { data: created } = await supabaseAdmin
        .from("waitlist_signups" as never)
        .insert({
          name: displayName,
          email,
          source: "signup",
          approved_at: new Date().toISOString(),
          referred_by: referrerId,
        } as never)
        .select("id, first_signin_at")
        .single();
      me = (created as { id: string; first_signin_at: string | null } | null) ?? null;
      if (!me) return { claimed: false as const };

      if (referrerId) {
        const { error: edgeErr } = await supabaseAdmin
          .from("waitlist_referrals" as never)
          .insert({
            referrer_id: referrerId,
            referred_id: me.id,
            referred_email: email,
          } as never);
        if (!edgeErr) {
          const { data: refCurrent } = await supabaseAdmin
            .from("waitlist_signups" as never)
            .select("referral_count")
            .eq("id", referrerId)
            .maybeSingle();
          const next = ((refCurrent as { referral_count: number } | null)?.referral_count ?? 0) + 1;
          await supabaseAdmin
            .from("waitlist_signups" as never)
            .update({ referral_count: next } as never)
            .eq("id", referrerId);
        }
      }
    }

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

export const getMyReferral = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | null)?.email?.toLowerCase();
    if (!email) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("waitlist_signups" as never)
      .select("id, referral_code, referral_count")
      .eq("email", email)
      .maybeSingle();
    const me = row as
      | { id: string; referral_code: string | null; referral_count: number }
      | null;
    if (!me?.referral_code) return null;

    const { count: activated } = await supabaseAdmin
      .from("waitlist_referrals" as never)
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", me.id)
      .not("activated_at", "is", null);

    return {
      code: me.referral_code,
      invited: me.referral_count ?? 0,
      joined: activated ?? 0,
      creditsEarned: (activated ?? 0) * REFERRER_CREDITS,
    };
  });
