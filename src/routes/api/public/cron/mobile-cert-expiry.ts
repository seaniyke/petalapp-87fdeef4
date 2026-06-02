/**
 * Daily Apple signing-cert expiry warning.
 *
 * Scans `mobile_signing_profiles` for any project whose Apple provisioning
 * profile (or P12, when populated) expires within `WARN_WINDOW_DAYS`. Logs
 * a structured warning per match so ops can act before builds start failing.
 *
 * We deliberately don't email users yet — the admin column on
 * `/admin/mobile-signing` is the first surface. Email/in-app notifications
 * can hang off the same query later.
 *
 * Auth: `x-petal-cron-secret` header must match `BUILDER_SHARED_SECRET`.
 * Schedule: once daily (pg_cron).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WARN_WINDOW_DAYS = 30;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function scanExpiringCerts() {
  const cutoff = new Date(
    Date.now() + WARN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: profiles, error } = await supabaseAdmin
    .from("mobile_signing_profiles")
    .select(
      "project_id, apple_team_id, apple_bundle_id, apple_p12_not_after, apple_provisioning_profile_not_after",
    )
    .or(
      `apple_provisioning_profile_not_after.lte.${cutoff},apple_p12_not_after.lte.${cutoff}`,
    );
  if (error) throw new Error(`scan: ${error.message}`);
  if (!profiles?.length) return { warned: 0, expired: 0 };

  let warned = 0;
  let expired = 0;
  const now = Date.now();
  for (const p of profiles) {
    const dates = [
      p.apple_provisioning_profile_not_after,
      p.apple_p12_not_after,
    ].filter((d): d is string => !!d);
    if (!dates.length) continue;
    const soonest = Math.min(...dates.map((d) => new Date(d).getTime()));
    const days = Math.floor((soonest - now) / (24 * 60 * 60 * 1000));
    if (days < 0) {
      expired++;
      console.warn(
        `[mobile-cert-expiry] EXPIRED project=${p.project_id} team=${p.apple_team_id ?? "?"} bundle=${p.apple_bundle_id ?? "?"} daysAgo=${-days}`,
      );
    } else {
      warned++;
      console.warn(
        `[mobile-cert-expiry] expiring project=${p.project_id} team=${p.apple_team_id ?? "?"} bundle=${p.apple_bundle_id ?? "?"} inDays=${days}`,
      );
    }
  }
  return { warned, expired };
}

export const Route = createFileRoute("/api/public/cron/mobile-cert-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const provided = request.headers.get("x-petal-cron-secret");
        if (!provided || provided !== secret) return unauthorized();
        try {
          const result = await scanExpiringCerts();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[mobile-cert-expiry] failed", msg);
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
        try {
          const result = await scanExpiringCerts();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
