/**
 * Daily domain renewal job.
 * Auth: `x-petal-cron-secret` must match BUILDER_SHARED_SECRET (server-only),
 * because this spends registrar balance and customer credits.
 * `?dry=1` lists what is due without renewing.
 */
import { createFileRoute } from "@tanstack/react-router";
import { secretsMatch } from "@/server/rate-limit.server";

async function run(request: Request) {
  const provided = request.headers.get("x-petal-cron-secret") ?? "";
  const expected = process.env["BUILDER_SHARED_SECRET"] ?? "";
  if (!expected || !secretsMatch(provided, expected)) return new Response("Unauthorized", { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  if (dry) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { AUTO_RENEW_WINDOW_DAYS } = await import("@/server/domain-renewal.server");
    const until = new Date(Date.now() + AUTO_RENEW_WINDOW_DAYS * 86400_000).toISOString();
    const { data } = await supabaseAdmin
      .from("purchased_domains")
      .select("hostname, expires_at, auto_renew, renewal_status")
      .eq("status", "active").lte("expires_at", until);
    return Response.json({ dry: true, due: data ?? [] });
  }
  const { runDueRenewals } = await import("@/server/domain-renewal.server");
  return Response.json(await runDueRenewals());
}

export const Route = createFileRoute("/api/public/cron/domain-renewals")({
  server: { handlers: { POST: async ({ request }) => run(request), GET: async ({ request }) => run(request) } },
});
