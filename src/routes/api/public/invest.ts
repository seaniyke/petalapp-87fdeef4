/**
 * POST /api/public/invest
 *
 * Captures an investor-interest pledge (waitlist). No charge. We store
 * name/email/amount/note and reply with { ok: true }. A team member follows
 * up via email to move things forward.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  amountUsd: z.number().int().positive().max(10_000_000).optional(),
  note: z.string().trim().max(1500).optional(),
  contactPref: z.enum(["email", "whatsapp", "call"]).optional(),
});

export const Route = createFileRoute("/api/public/invest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ error: "Please fill in your name, a valid email, and (optionally) an amount." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const ipHeader =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null;
          const ip = ipHeader ? ipHeader.split(",")[0].trim() : null;
          const ua = request.headers.get("user-agent");

          const { error } = await supabaseAdmin.from("invest_pledges").insert({
            name: parsed.name,
            email: parsed.email,
            amount_usd_intended: parsed.amountUsd ?? null,
            note: parsed.note ?? null,
            contact_pref: parsed.contactPref ?? null,
            ip,
            user_agent: ua,
          } as never);
          if (error) throw new Error(error.message);

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[invest] failed", err);
          return new Response(
            JSON.stringify({ error: "Could not save your pledge. Please try again." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
