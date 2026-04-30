/**
 * POST /api/admin/paystack-plans
 *
 * Admin-only. Provisions Paystack Plans for every (billing_plan, currency)
 * combination that doesn't already have one, then writes the returned
 * plan_code back to the catalog.
 *
 * Idempotent — only creates plans whose `paystack_plan_code_<ccy>` column is
 * NULL on a given billing_plan row.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createPlan } from "@/server/paystack.server";
import { resolvePrice } from "@/server/billing-pricing.server";

const CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;
type Ccy = (typeof CURRENCIES)[number];
const COL: Record<Ccy, string> = {
  NGN: "paystack_plan_code_ngn",
  GHS: "paystack_plan_code_ghs",
  KES: "paystack_plan_code_kes",
  ZAR: "paystack_plan_code_zar",
  USD: "paystack_plan_code_usd",
};

export const Route = createFileRoute("/api/admin/paystack-plans")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        // Verify admin role.
        const { data: roleRow } = await supabaseAdmin
          .from("user_roles" as never)
          .select("role")
          .eq("user_id", userData.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (!roleRow) return new Response("Forbidden", { status: 403 });

        const { data: plans, error } = await supabaseAdmin
          .from("billing_plans")
          .select(
            "code, name, price_cents, paystack_interval, paystack_plan_code_ngn, paystack_plan_code_ghs, paystack_plan_code_kes, paystack_plan_code_zar, paystack_plan_code_usd, is_active",
          );
        if (error) throw new Error(error.message);

        const created: Array<{ plan: string; ccy: Ccy; code: string }> = [];
        const skipped: Array<{ plan: string; ccy: Ccy; reason: string }> = [];

        for (const p of plans ?? []) {
          if (!p.is_active || p.code === "free" || (p.price_cents ?? 0) <= 0) continue;
          for (const ccy of CURRENCIES) {
            const existing = (p as Record<string, unknown>)[COL[ccy]] as string | null;
            if (existing) {
              skipped.push({ plan: p.code, ccy, reason: "already_provisioned" });
              continue;
            }
            try {
              const price = await resolvePrice("plan", p.code, ccy);
              const result = await createPlan({
                name: `Petal ${p.name} (${ccy})`,
                amountMinor: price.amountMinor,
                currency: ccy,
                interval: (p as { paystack_interval?: string }).paystack_interval ?? "monthly",
              });
              await supabaseAdmin
                .from("billing_plans")
                .update({ [COL[ccy]]: result.plan_code } as never)
                .eq("code", p.code);
              created.push({ plan: p.code, ccy, code: result.plan_code });
            } catch (e) {
              skipped.push({
                plan: p.code,
                ccy,
                reason: e instanceof Error ? e.message : "unknown",
              });
            }
          }
        }

        return Response.json({ created, skipped });
      },
    },
  },
});
