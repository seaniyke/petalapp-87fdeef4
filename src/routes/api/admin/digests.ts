/**
 * Admin endpoint for the daily self-learning digests.
 *
 * Auth: requires a Supabase session bearer token belonging to a user with
 * the `admin` role in `user_roles`.
 *
 * Actions (POST body `{ action: "..." }`):
 *   - "list": Returns the last 30 stored digests (id, period_date, totals).
 *   - "get":  Returns one full stored digest by `id` or `period_date`.
 *   - "run_now": Builds + persists today's digest immediately (does NOT
 *     send email). Useful to preview tomorrow's email.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSelfLearningDigest } from "@/server/self-learning-digest.server";

async function requireAdmin(req: Request): Promise<Response | { userId: string }> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
  const userId = userRes.user.id;
  const { data: role } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) return new Response("Forbidden", { status: 403 });
  return { userId };
}

export const Route = createFileRoute("/api/admin/digests")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireAdmin(request);
        if (guard instanceof Response) return guard;

        let body: { action?: string; id?: string; period_date?: string } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        try {
          if (body.action === "list") {
            const { data, error } = await supabaseAdmin
              .from("petal_self_learning_digests" as never)
              .select(
                "id, period_date, generated_at, total_turns, total_projects, total_users, verifier_pass_rate, build_success_rate, followup_was_fix_rate, email_sent_at, email_recipients, email_error",
              )
              .order("period_date", { ascending: false })
              .limit(30);
            if (error) throw new Error(error.message);
            return Response.json({ digests: data ?? [] });
          }

          if (body.action === "get") {
            if (!body.id && !body.period_date) {
              return Response.json({ error: "id or period_date required" }, { status: 400 });
            }
            const base = supabaseAdmin
              .from("petal_self_learning_digests" as never)
              .select("*");
            const filtered = body.id
              ? base.eq("id", body.id)
              : base.eq("period_date", body.period_date as string);
            const { data, error } = await filtered.maybeSingle();
            if (error) throw new Error(error.message);
            return Response.json({ digest: data });
          }

          if (body.action === "run_now") {
            const digest = await buildSelfLearningDigest();
            const { data, error } = await supabaseAdmin
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
                } as never,
                { onConflict: "period_date" },
              )
              .select()
              .maybeSingle();
            if (error) throw new Error(error.message);
            return Response.json({ digest: data });
          }

          return Response.json({ error: "Unknown action" }, { status: 400 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
