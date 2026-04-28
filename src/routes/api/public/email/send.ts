/**
 * POST /api/public/email/send
 *
 * Public email send endpoint for generated Petal apps.
 *
 * Auth:    Authorization: Bearer pet_xxxxxxxxxx (per-project token)
 * Body:    { to: string|string[], subject: string, html?: string, text?: string, reply_to?: string }
 * Returns: { messageId } | { error }
 *
 * Quota is enforced before send. Every attempt is logged to petal_email_outbound.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateRequest,
  checkAndIncrementQuota,
  logOutbound,
  sendViaResend,
} from "@/server/petal-email.server";

const SendSchema = z.object({
  to: z.union([
    z.string().email().max(254),
    z.array(z.string().email().max(254)).min(1).max(50),
  ]),
  subject: z.string().min(1).max(200),
  html: z.string().max(500_000).optional(),
  text: z.string().max(500_000).optional(),
  reply_to: z.string().email().max(254).optional(),
}).refine((d) => d.html || d.text, {
  message: "Either 'html' or 'text' is required",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const Route = createFileRoute("/api/public/email/send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        // 1. Auth
        const sub = await authenticateRequest(request.headers.get("authorization"));
        if (!sub) {
          return json({ error: "Invalid or missing API token" }, 401);
        }

        // 2. Validate
        let payload: z.infer<typeof SendSchema>;
        try {
          payload = SendSchema.parse(await request.json());
        } catch (err) {
          const msg = err instanceof z.ZodError ? err.issues[0]?.message : "Invalid request body";
          return json({ error: msg }, 400);
        }

        const recipientPrimary = Array.isArray(payload.to) ? payload.to[0] : payload.to;

        // 3. Quota
        const quota = await checkAndIncrementQuota(sub.project_id, sub.monthly_cap, sub.daily_cap);
        if (!quota.allowed) {
          await logOutbound({
            projectId: sub.project_id,
            recipient: recipientPrimary,
            subject: payload.subject,
            status: "suppressed",
            errorMessage: quota.reason,
          });
          return json(
            {
              error: quota.reason,
              monthly_used: quota.monthlyUsed,
              monthly_cap: quota.monthlyCap,
              daily_used: quota.dailyUsed,
              daily_cap: quota.dailyCap,
            },
            429
          );
        }

        // 4. Send
        try {
          const { messageId } = await sendViaResend(sub, payload);
          await logOutbound({
            projectId: sub.project_id,
            recipient: recipientPrimary,
            subject: payload.subject,
            status: "sent",
            resendMessageId: messageId,
          });
          return json({
            messageId,
            monthly_used: quota.monthlyUsed,
            monthly_cap: quota.monthlyCap,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await logOutbound({
            projectId: sub.project_id,
            recipient: recipientPrimary,
            subject: payload.subject,
            status: "failed",
            errorMessage,
          });
          return json({ error: errorMessage }, 502);
        }
      },
    },
  },
});
