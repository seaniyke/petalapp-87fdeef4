/**
 * Admin endpoint for the daily self-learning digests.
 *
 * Auth: requires a Supabase session bearer token belonging to a user with
 * the `admin` role in `user_roles`.
 *
 * Actions (POST body `{ action: "..." }`):
 *   - "list": Returns the last 30 stored digests (id, period_date, totals).
 *   - "get": Returns one full stored digest by `id` or `period_date`.
 *   - "run_now": Builds + persists today's digest immediately (does NOT
 *     send email). Useful for "show me what tomorrow's email will look like".
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSelfLearningDigest } from "@/server/self-learning-digest.server";

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
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
              .from("petal_self_learning_digests")
              .select("id, period_date, window_label, totals, created_at, sent_to_count")
              .order("period_date", { ascending: false })
              .limit(30);
            if (error) throw new Error(error.message);
            return Response.json({ digests: data ?? [] });
          }

          if (body.action === "get") {
            let q = supabaseAdmin
              .from("petal_self_learning_digests")
              .select("*")
              .limit(1);
            if (body.id) q = q.eq("id", body.id);
            else if (body.period_date) q = q.eq("period_date", body.period_date);
            else return Response.json({ error: "id or period_date required" }, { status: 400 });
            const { data, error } = await q.maybeSingle();
            if (error) throw new Error(error.message);
            return Response.json({ digest: data });
          }

          if (body.action === "run_now") {
            const payload = await buildSelfLearningDigest();
            const { data, error } = await supabaseAdmin
              .from("petal_self_learning_digests")
              .upsert(
                {
                  period_date: payload.periodDate,
                  window_label: payload.windowLabel,
                  totals: payload.totals,
                  top_failure_signatures: payload.topFailureSignatures,
                  top_reverted_prompts: payload.topRevertedPrompts,
                  model_breakdown: payload.modelBreakdown,
                  recommendations: payload.recommendations,
                },
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
