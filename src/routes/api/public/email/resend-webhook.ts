/**
 * POST /api/public/email/resend-webhook
 *
 * Receives Resend → Svix-signed webhook events for ALL Petal Email projects.
 *
 * Events handled:
 *   email.sent | email.delivered  → update outbound status to "sent"
 *   email.bounced                 → status="bounced", add to suppressions
 *   email.complained              → status="complained", add to suppressions
 *   email.delivery_delayed        → no-op (Resend will retry)
 *
 * The originating project_id is recovered from petal_email_outbound via the
 * resend_message_id (which is unique per send). If we can't find the row,
 * the event is acknowledged (200) but ignored — typically a stale send from
 * before this column existed.
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  addSuppression,
  verifyResendWebhook,
} from "@/server/petal-email.server";

interface ResendEventEmailData {
  email_id?: string;
  to?: string | string[];
  from?: string;
  subject?: string;
  bounce?: { type?: string; subType?: string; message?: string };
  complaint?: { type?: string; message?: string };
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: ResendEventEmailData;
}

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/email/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not configured");
          return ok({ error: "Webhook secret not configured" }, 500);
        }

        const rawBody = await request.text();
        const valid = verifyResendWebhook({
          rawBody,
          svixId: request.headers.get("svix-id"),
          svixTimestamp: request.headers.get("svix-timestamp"),
          svixSignature: request.headers.get("svix-signature"),
          secret,
        });
        if (!valid) {
          return ok({ error: "Invalid signature" }, 401);
        }

        let evt: ResendEvent;
        try {
          evt = JSON.parse(rawBody) as ResendEvent;
        } catch {
          return ok({ error: "Invalid JSON" }, 400);
        }

        const type = evt.type ?? "";
        const messageId = evt.data?.email_id;
        if (!messageId) {
          return ok({ ok: true, ignored: "no email_id" });
        }

        // Look up the original send to recover project_id
        const { data: outbound } = await supabaseAdmin
          .from("petal_email_outbound")
          .select("project_id, recipient_email")
          .eq("resend_message_id", messageId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!outbound) {
          // Send pre-dates this handler, or another tenant — ack & drop
          return ok({ ok: true, ignored: "unknown message_id" });
        }

        const projectId = outbound.project_id;
        const recipient = outbound.recipient_email;

        switch (type) {
          case "email.sent":
          case "email.delivered": {
            // We already log "sent" at request time; insert a delivered row
            // for analytics deduplication on resend_message_id.
            await supabaseAdmin.from("petal_email_outbound").insert({
              project_id: projectId,
              recipient_email: recipient,
              status: "sent",
              resend_message_id: messageId,
              metadata: { event: type, source: "webhook" },
            } as never);
            break;
          }
          case "email.bounced": {
            const reason =
              evt.data?.bounce?.message ?? evt.data?.bounce?.subType ?? "bounced";
            await supabaseAdmin.from("petal_email_outbound").insert({
              project_id: projectId,
              recipient_email: recipient,
              status: "bounced",
              resend_message_id: messageId,
              error_message: String(reason).slice(0, 500),
              metadata: { event: type, bounce: evt.data?.bounce ?? null },
            } as never);
            await addSuppression({
              projectId,
              email: recipient,
              reason: "bounced",
              sourceMessageId: messageId,
            });
            break;
          }
          case "email.complained": {
            await supabaseAdmin.from("petal_email_outbound").insert({
              project_id: projectId,
              recipient_email: recipient,
              status: "complained",
              resend_message_id: messageId,
              error_message: "Recipient marked as spam",
              metadata: { event: type, complaint: evt.data?.complaint ?? null },
            } as never);
            await addSuppression({
              projectId,
              email: recipient,
              reason: "complained",
              sourceMessageId: messageId,
            });
            break;
          }
          case "email.delivery_delayed":
          case "email.opened":
          case "email.clicked":
          default:
            // Acknowledge but don't act
            break;
        }

        return ok({ ok: true, type });
      },
    },
  },
});
