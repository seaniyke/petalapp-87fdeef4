/**
 * Daily self-learning digest cron.
 *
 * Schedule: 00:00 UTC daily via pg_cron.
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 *
 * Flow:
 *   1. Build the digest payload from the last 24h of telemetry.
 *   2. Upsert into `petal_self_learning_digests` (one row per UTC day).
 *   3. Resolve admin recipients via user_roles.
 *   4. Send the rendered HTML email via Resend.
 *   5. Patch the row with delivery status.
 *
 * Idempotent: rerunning the same day overwrites the row and sends a fresh
 * email. Useful when fixing a digest bug and wanting today's data again.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildSelfLearningDigest,
  renderDigestHtml,
  resolveAdminRecipients,
} from "@/server/self-learning-digest.server";

const RESEND_API = "https://api.resend.com";
const SENDER = "Petal <noreply@buildwithpetal.com>";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function runDigest(opts: { skipEmail?: boolean } = {}) {
  const digest = await buildSelfLearningDigest();

  // Upsert by period_date so reruns replace today's row instead of duplicating.
  const { data: row, error: upsertError } = await supabaseAdmin
    .from("petal_self_learning_digests" as never)
    .upsert(
      {
        period_date: digest.periodDate,
        generated_at: new Date().toISOString(),
        total_turns: digest.totals.turns,
        total_projects: digest.totals.projects,
        total_users: digest.totals.users,
        verifier_pass_rate: digest.totals.verifierPassRate,
        build_success_rate: digest.totals.buildSuccessRate,
        followup_was_fix_rate: digest.totals.followupWasFixRate,
        avg_autofix_count: digest.totals.avgAutofixCount,
        top_failure_signatures: digest.topFailureSignatures,
        top_reverted_prompts: digest.topRevertedPrompts,
        model_breakdown: digest.modelBreakdown,
        recommendations: digest.recommendations,
        payload: digest as unknown as Record<string, unknown>,
        // Reset email status on rerun; we'll overwrite below if we send.
        email_sent_at: null,
        email_recipients: null,
        email_error: null,
      },
      { onConflict: "period_date" },
    )
    .select("id")
    .single();
  if (upsertError) {
    throw new Error(`digest upsert failed: ${upsertError.message}`);
  }

  if (opts.skipEmail) {
    return { digest, rowId: row?.id ?? null, emailSent: false, recipients: [] };
  }

  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) {
    await supabaseAdmin
      .from("petal_self_learning_digests" as never)
      .update({ email_error: "no admin recipients resolved" })
      .eq("id", row!.id);
    return { digest, rowId: row?.id ?? null, emailSent: false, recipients };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    await supabaseAdmin
      .from("petal_self_learning_digests" as never)
      .update({ email_error: "RESEND_API_KEY not configured" })
      .eq("id", row!.id);
    return {
      digest,
      rowId: row?.id ?? null,
      emailSent: false,
      recipients,
      error: "RESEND_API_KEY not configured",
    };
  }

  const html = renderDigestHtml(digest);
  const subject = `Petal · Daily digest · ${digest.periodDate} · ${digest.totals.turns} turns`;

  let emailError: string | null = null;
  try {
    const res = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SENDER,
        to: recipients,
        subject,
        html,
        tags: [
          { name: "kind", value: "self_learning_digest" },
          { name: "period", value: digest.periodDate },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      emailError = `Resend ${res.status}: ${detail.slice(0, 240)}`;
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }

  await supabaseAdmin
    .from("petal_self_learning_digests" as never)
    .update({
      email_sent_at: emailError ? null : new Date().toISOString(),
      email_recipients: recipients,
      email_error: emailError,
    })
    .eq("id", row!.id);

  return {
    digest,
    rowId: row?.id ?? null,
    emailSent: !emailError,
    recipients,
    error: emailError ?? undefined,
  };
}

export const Route = createFileRoute("/api/public/cron/self-learning-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();

        // Allow ?skip_email=1 for safe manual reruns from the admin page.
        const skipEmail = new URL(request.url).searchParams.get("skip_email") === "1";

        try {
          const result = await runDigest({ skipEmail });
          return Response.json({
            ok: true,
            period: result.digest.periodDate,
            turns: result.digest.totals.turns,
            email_sent: result.emailSent,
            recipients_count: result.recipients.length,
            error: result.error ?? null,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[self-learning-digest cron] failed", msg);
          return new Response(msg, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-petal-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!provided || provided !== secret) return unauthorized();
        const skipEmail = new URL(request.url).searchParams.get("skip_email") === "1";
        try {
          const result = await runDigest({ skipEmail });
          return Response.json({
            ok: true,
            period: result.digest.periodDate,
            turns: result.digest.totals.turns,
            email_sent: result.emailSent,
            recipients_count: result.recipients.length,
            error: result.error ?? null,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
