/**
 * GET /api/internal/health — prod env presence checker.
 *
 * Reports which critical env vars are present vs missing on the running
 * Worker, WITHOUT echoing any values. Gated by a bearer token so it can't
 * be probed externally. Use during deploy verification to confirm the
 * production secrets bundle is intact.
 *
 * Auth: `Authorization: Bearer ${INTERNAL_HEALTH_TOKEN}`.
 *   If INTERNAL_HEALTH_TOKEN itself is not set, the endpoint returns 503
 *   (fail-closed) so missing config can't accidentally make this public.
 */
import { createFileRoute } from "@tanstack/react-router";

/**
 * Vars we expect in BOTH preview and prod. Grouped for readable output.
 * Keep this list in sync with docs/ops/prod-env.md.
 */
const REQUIRED_VARS = {
  supabase: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  ai: ["LOVABLE_API_KEY"],
  builder: ["BUILDER_URL", "BUILDER_SHARED_SECRET"],
  mobile: [
    "CODEMAGIC_API_TOKEN",
    "CODEMAGIC_APP_TEMPLATE_ID",
    "EXPO_ACCESS_TOKEN",
    "MOBILE_SIGNING_KEY",
    "GITHUB_MOBILE_TOKEN",
  ],
  email: ["PETAL_EMAIL_API_KEY", "PETAL_EMAIL_FROM"],
  payments: ["PADDLE_API_KEY", "PAYSTACK_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY"],
  domains: ["CLOUDFLARE_REGISTRAR_TOKEN"],
} as const;

type Group = keyof typeof REQUIRED_VARS;

export const Route = createFileRoute("/api/internal/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.INTERNAL_HEALTH_TOKEN;
        if (!expected) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "INTERNAL_HEALTH_TOKEN not configured on this deployment",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
        if (token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const groups: Record<Group, { present: string[]; missing: string[] }> = {
          supabase: { present: [], missing: [] },
          ai: { present: [], missing: [] },
          builder: { present: [], missing: [] },
          mobile: { present: [], missing: [] },
          email: { present: [], missing: [] },
          payments: { present: [], missing: [] },
          domains: { present: [], missing: [] },
        };

        let totalPresent = 0;
        let totalMissing = 0;
        for (const [groupKey, vars] of Object.entries(REQUIRED_VARS) as [Group, readonly string[]][]) {
          for (const name of vars) {
            const v = process.env[name];
            if (v && v.length > 0) {
              groups[groupKey].present.push(name);
              totalPresent++;
            } else {
              groups[groupKey].missing.push(name);
              totalMissing++;
            }
          }
        }

        return new Response(
          JSON.stringify(
            {
              ok: totalMissing === 0,
              checkedAt: new Date().toISOString(),
              summary: { present: totalPresent, missing: totalMissing },
              groups,
            },
            null,
            2,
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  },
});
