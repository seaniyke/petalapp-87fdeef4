/**
 * Public waitlist endpoint.
 *
 *   GET  /api/public/waitlist                  -> { enabled }
 *   GET  /api/public/waitlist?email=…          -> { enabled, approved }
 *   GET  /api/public/waitlist?token=…          -> { status: {...} }
 *   POST /api/public/waitlist                  -> { ok, statusToken, referralCode, alreadyJoined? }
 *
 * Joining is idempotent on email, fires a confirmation email through the
 * existing transactional queue, and credits the referrer who sent them.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AUTO_APPROVE_AT, MILESTONES } from "@/lib/referral";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  source: z.string().trim().max(60).optional(),
  ref: z.string().trim().max(32).optional(),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Signup = {
  id: string;
  name: string;
  email: string;
  referral_code: string | null;
  referral_count: number;
  approved_at: string | null;
};

/** Fire-and-forget send through the existing transactional queue. */
async function sendEmail(
  origin: string,
  payload: {
    templateName: string;
    recipientEmail: string;
    idempotencyKey: string;
    templateData: Record<string, unknown>;
  },
) {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) {
    console.warn("[waitlist] BUILDER_SHARED_SECRET missing — email skipped", payload.templateName);
    return;
  }
  try {
    const resp = await fetch(new URL("/lovable/email/transactional/send", origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.warn("[waitlist] send failed", payload.templateName, resp.status, await resp.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[waitlist] send threw", payload.templateName, e);
  }
}

export const Route = createFileRoute("/api/public/waitlist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);

          // Status page read — token only, no account needed.
          const token = url.searchParams.get("token");
          if (token) {
            const { data, error } = await supabaseAdmin.rpc("waitlist_status" as never, {
              _token: token.slice(0, 128),
            } as never);
            if (error) throw new Error(error.message);
            const row = Array.isArray(data) ? data[0] : data;
            if (!row) return json({ status: null }, 404);
            return json({ status: row });
          }

          const { data } = await supabaseAdmin
            .from("system_settings")
            .select("value")
            .eq("key", "access.waitlist_mode")
            .maybeSingle();
          const enabled = data?.value === true;

          // Optional per-person access check: ?email=someone@example.com
          const emailParam = url.searchParams.get("email");
          if (emailParam) {
            const email = emailParam.trim().toLowerCase().slice(0, 255);
            const { data: row } = await supabaseAdmin
              .from("waitlist_signups" as never)
              .select("approved_at")
              .eq("email", email)
              .maybeSingle();
            const approved = Boolean((row as { approved_at: string | null } | null)?.approved_at);
            return json({ enabled, approved });
          }

          return json({ enabled });
        } catch (err) {
          console.error("[waitlist] GET failed", err);
          return json({ enabled: false });
        }
      },

      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return json({ error: "Please enter your name and a valid email." }, 400);
        }

        const email = parsed.email.toLowerCase();
        const origin = new URL(request.url).origin;

        try {
          const ipHeader =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null;
          const ip = ipHeader ? ipHeader.split(",")[0].trim() : null;

          const { data: existingRow } = await supabaseAdmin
            .from("waitlist_signups" as never)
            .select("id, status_token, referral_code")
            .eq("email", email)
            .maybeSingle();

          if (existingRow) {
            const e = existingRow as { status_token: string; referral_code: string };
            return json({
              ok: true,
              alreadyJoined: true,
              statusToken: e.status_token,
              referralCode: e.referral_code,
            });
          }

          // Resolve the referrer (self-referral and unknown codes are ignored).
          let referrer: Signup | null = null;
          if (parsed.ref) {
            const { data: refRow } = await supabaseAdmin
              .from("waitlist_signups" as never)
              .select("id, name, email, referral_code, referral_count, approved_at")
              .eq("referral_code", parsed.ref.toLowerCase())
              .maybeSingle();
            const candidate = refRow as Signup | null;
            if (candidate && candidate.email.toLowerCase() !== email) referrer = candidate;
          }

          const { data: inserted, error } = await supabaseAdmin
            .from("waitlist_signups" as never)
            .insert({
              name: parsed.name,
              email,
              source: parsed.source ?? null,
              ip,
              user_agent: request.headers.get("user-agent"),
              referred_by: referrer?.id ?? null,
            } as never)
            .select("id, status_token, referral_code")
            .single();
          if (error) throw new Error(error.message);
          const me = inserted as unknown as {
            id: string;
            status_token: string;
            referral_code: string;
          };

          // Credit the referrer: one edge per referred email, then bump the count.
          if (referrer) {
            const { error: refErr } = await supabaseAdmin
              .from("waitlist_referrals" as never)
              .insert({
                referrer_id: referrer.id,
                referred_id: me.id,
                referred_email: email,
              } as never);

            if (!refErr) {
              const nextCount = (referrer.referral_count ?? 0) + 1;
              const shouldApprove = !referrer.approved_at && nextCount >= AUTO_APPROVE_AT;
              await supabaseAdmin
                .from("waitlist_signups" as never)
                .update({
                  referral_count: nextCount,
                  ...(shouldApprove ? { approved_at: new Date().toISOString() } : {}),
                } as never)
                .eq("id", referrer.id);

              if (shouldApprove) {
                await sendEmail(origin, {
                  templateName: "waitlist-invite",
                  recipientEmail: referrer.email,
                  idempotencyKey: `waitlist-invite-${referrer.id}`,
                  templateData: {
                    name: referrer.name,
                    email: referrer.email,
                    signInUrl: `https://buildwithpetal.com/auth?mode=signup&approved=${encodeURIComponent(referrer.email)}`,
                  },
                });
              } else if (MILESTONES.includes(nextCount)) {
                await sendEmail(origin, {
                  templateName: "waitlist-referral-milestone",
                  recipientEmail: referrer.email,
                  idempotencyKey: `waitlist-milestone-${referrer.id}-${nextCount}`,
                  templateData: {
                    name: referrer.name,
                    count: nextCount,
                    referralCode: referrer.referral_code,
                  },
                });
              }
            }
          }

          await sendEmail(origin, {
            templateName: "waitlist-confirmation",
            recipientEmail: email,
            idempotencyKey: `waitlist-confirm-${email}`,
            templateData: {
              name: parsed.name,
              email,
              referralCode: me.referral_code,
              statusToken: me.status_token,
            },
          });

          return json({
            ok: true,
            statusToken: me.status_token,
            referralCode: me.referral_code,
          });
        } catch (err) {
          console.error("[waitlist] join failed", err);
          return json({ error: "Could not save your spot. Please try again." }, 500);
        }
      },
    },
  },
});
