/**
 * Public waitlist endpoint.
 *
 *   GET  /api/public/waitlist  -> { enabled: boolean }
 *   POST /api/public/waitlist  -> { ok: true, alreadyJoined?: boolean }
 *
 * When waitlist mode is on, the app hides sign-up behind this form.
 * Joining is idempotent on email and fires a confirmation email through
 * the existing transactional email queue.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  source: z.string().trim().max(60).optional(),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/public/waitlist")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { data } = await supabaseAdmin
            .from("system_settings")
            .select("value")
            .eq("key", "access.waitlist_mode")
            .maybeSingle();
          return json({ enabled: data?.value === true });
        } catch {
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

        try {
          const ipHeader =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null;
          const ip = ipHeader ? ipHeader.split(",")[0].trim() : null;

          const { data: existing } = await supabaseAdmin
            .from("waitlist_signups" as never)
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (existing) return json({ ok: true, alreadyJoined: true });

          const { error } = await supabaseAdmin.from("waitlist_signups" as never).insert({
            name: parsed.name,
            email,
            source: parsed.source ?? null,
            ip,
            user_agent: request.headers.get("user-agent"),
          } as never);
          if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);

          // Confirmation email — never blocks or fails the signup.
          try {
            const secret = process.env.BUILDER_SHARED_SECRET;
            if (secret) {
              const url = new URL(
                "/lovable/email/transactional/send",
                new URL(request.url).origin,
              ).toString();
              await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-petal-internal-secret": secret,
                },
                body: JSON.stringify({
                  templateName: "waitlist-confirmation",
                  recipientEmail: email,
                  idempotencyKey: `waitlist-confirm-${email}`,
                  templateData: { name: parsed.name },
                }),
              });
            }
          } catch (e) {
            console.warn("[waitlist] confirmation email failed (non-fatal)", e);
          }

          return json({ ok: true });
        } catch (err) {
          console.error("[waitlist] join failed", err);
          return json({ error: "Could not save your spot. Please try again." }, 500);
        }
      },
    },
  },
});
