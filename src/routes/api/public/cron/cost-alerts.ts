/**
 * Daily cost-alert cron (internal, admin-only output).
 *
 * Schedule: 01:00 UTC daily via pg_cron.
 * Auth: requires `x-petal-cron-secret` matching `BUILDER_SHARED_SECRET`.
 *
 * Emails admins only when at least one threshold is crossed, so a quiet day
 * produces no mail. `?force=1` sends regardless (useful for verifying setup),
 * `?dry=1` returns the report without sending.
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildCostAlertReport, renderCostAlertHtml } from "@/server/cost-alerts.server";
import { resolveAdminRecipients } from "@/server/self-learning-digest.server";
import { secretsMatch } from "@/server/rate-limit.server";

const RESEND_API = "https://api.resend.com";
const SENDER = "Kimble <noreply@buildwithpetal.com>";

async function run(request: Request) {
  const provided = request.headers.get("x-petal-cron-secret") ?? "";
  const expected = process.env["BUILDER_SHARED_SECRET"] ?? "";
  if (!expected || !secretsMatch(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const windowDays = Math.max(1, Math.min(30, Number(url.searchParams.get("days") ?? 1) || 1));
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";

  const report = await buildCostAlertReport(windowDays);
  const shouldSend = !dry && (force || report.alerts.length > 0);

  let emailed = false;
  let emailError: string | null = null;
  if (shouldSend) {
    const recipients = await resolveAdminRecipients();
    const apiKey = process.env["RESEND_API_KEY"];
    if (recipients.length === 0) emailError = "no admin recipients resolved";
    else if (!apiKey) emailError = "RESEND_API_KEY not configured";
    else {
      const critical = report.alerts.some((a) => a.level === "critical");
      try {
        const res = await fetch(`${RESEND_API}/emails`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: SENDER,
            to: recipients,
            subject: `Kimble · Cost alerts${critical ? " · action needed" : ""} · ${report.alerts.length} alert(s)`,
            html: renderCostAlertHtml(report),
            tags: [{ name: "kind", value: "cost_alerts" }],
          }),
        });
        if (!res.ok) emailError = `Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 240)}`;
        else emailed = true;
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, emailed, emailError, report }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/cron/cost-alerts")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
