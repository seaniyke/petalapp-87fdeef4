/**
 * POST /api/public/email/send
 *
 * Public email send endpoint for generated Petal apps.
 *
 * Auth:    Authorization: Bearer pet_xxxxxxxxxx (per-project token)
 * Body (Resend-aligned, snake_case):
 *   {
 *     to: string|string[],
 *     cc?: string|string[],
 *     bcc?: string|string[],
 *     subject: string,
 *     html?: string,
 *     text?: string,
 *     reply_to?: string|string[],
 *     headers?: Record<string,string>,
 *     tags?: [{ name, value }],
 *     scheduled_at?: string,
 *     attachments?: [{ filename, content?, path?, content_type?, content_id? }],
 *     idempotency_key?: string
 *   }
 * Returns: { messageId, idempotency_key } | { error }
 *
 * Quota is reserved BEFORE send (atomic RPC) and released on Resend failure.
 * Suppressed recipients are filtered before send. Every attempt is logged.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateRequest,
  reserveQuota,
  releaseQuota,
  filterSuppressed,
  logOutbound,
  sendViaResend,
} from "@/server/petal-email.server";

const emailField = z.union([
  z.string().email().max(254),
  z.array(z.string().email().max(254)).min(1).max(50),
]);

const tagRe = /^[A-Za-z0-9_-]{1,256}$/;

const SendSchema = z
  .object({
    to: emailField,
    cc: emailField.optional(),
    bcc: emailField.optional(),
    subject: z.string().min(1).max(200),
    html: z.string().max(500_000).optional(),
    text: z.string().max(500_000).optional(),
    reply_to: emailField.optional(),
    headers: z.record(z.string().max(200), z.string().max(2000)).optional(),
    tags: z
      .array(
        z.object({
          name: z.string().regex(tagRe),
          value: z.string().regex(tagRe),
        })
      )
      .max(50)
      .optional(),
    scheduled_at: z.string().min(1).max(64).optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string().min(1).max(255),
          content: z.string().max(40_000_000).optional(),
          path: z.string().url().max(2000).optional(),
          content_type: z.string().max(200).optional(),
          content_id: z.string().max(200).optional(),
        })
      )
      .max(20)
      .optional(),
    idempotency_key: z.string().min(1).max(256).optional(),
  })
  .refine((d) => d.html || d.text, {
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

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
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
          const msg =
            err instanceof z.ZodError ? err.issues[0]?.message : "Invalid request body";
          return json({ error: msg }, 400);
        }

        // 3. Suppression check (drops bounced/complained/unsubscribed addresses)
        const allRecipients = [
          ...asArray(payload.to),
          ...asArray(payload.cc),
          ...asArray(payload.bcc),
        ];
        const { allowed, suppressed } = await filterSuppressed(
          sub.project_id,
          allRecipients
        );

        // Log every suppressed recipient so dashboards show it
        for (const s of suppressed) {
          await logOutbound({
            projectId: sub.project_id,
            recipient: s,
            subject: payload.subject,
            status: "suppressed",
            errorMessage: "Recipient is on the suppression list",
          });
        }

        // If every recipient is suppressed, short-circuit (no quota burn)
        const allowedTo = asArray(payload.to).filter((r) => allowed.includes(r));
        if (allowedTo.length === 0) {
          return json(
            {
              error:
                "All recipients are suppressed (previously bounced, complained, or unsubscribed).",
              suppressed,
            },
            422
          );
        }

        const allowedCc = asArray(payload.cc).filter((r) => allowed.includes(r));
        const allowedBcc = asArray(payload.bcc).filter((r) => allowed.includes(r));
        const recipientPrimary = allowedTo[0];

        // 4. Reserve quota (atomic; will be released on send failure)
        const quota = await reserveQuota(
          sub.project_id,
          sub.monthly_cap,
          sub.daily_cap
        );
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

        // 5. Send
        try {
          const { messageId, idempotencyKey } = await sendViaResend(sub, {
            ...payload,
            to: allowedTo,
            cc: allowedCc.length ? allowedCc : undefined,
            bcc: allowedBcc.length ? allowedBcc : undefined,
          });
          await logOutbound({
            projectId: sub.project_id,
            recipient: recipientPrimary,
            subject: payload.subject,
            status: "sent",
            resendMessageId: messageId,
            idempotencyKey,
            metadata: { suppressed_count: suppressed.length },
          });
          return json({
            messageId,
            idempotency_key: idempotencyKey,
            monthly_used: quota.monthlyUsed,
            monthly_cap: quota.monthlyCap,
            ...(suppressed.length ? { suppressed } : {}),
          });
        } catch (err) {
          // Compensate: refund quota since the send failed
          await releaseQuota(sub.project_id).catch(() => {});
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
