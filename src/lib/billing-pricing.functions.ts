/**
 * Public pricing endpoint.
 *
 * The `billing_price_overrides` table is admin-only at the RLS level (it holds
 * internal per-currency pricing decisions). Shoppers still need the displayed
 * price, so we expose only the override amounts for ACTIVE, purchasable items
 * through this controlled server function.
 */
import { createServerFn } from "@tanstack/react-start";

export type PublicPriceOverride = {
  item_kind: "plan" | "pack" | "addon";
  item_code: string;
  currency_code: string;
  amount_minor: number;
};

export const getPublicPriceOverrides = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicPriceOverride[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [plans, packs, addons, overrides] = await Promise.all([
      supabaseAdmin.from("billing_plans").select("code").eq("is_active", true),
      supabaseAdmin.from("credit_packs").select("code").eq("is_active", true),
      supabaseAdmin.from("billing_addons").select("code").eq("is_active", true),
      supabaseAdmin
        .from("billing_price_overrides")
        .select("item_kind, item_code, currency_code, amount_minor"),
    ]);

    const active: Record<string, Set<string>> = {
      plan: new Set((plans.data ?? []).map((r) => r.code)),
      pack: new Set((packs.data ?? []).map((r) => r.code)),
      addon: new Set((addons.data ?? []).map((r) => r.code)),
    };

    return (overrides.data ?? [])
      .filter((o) => active[o.item_kind as keyof typeof active]?.has(o.item_code))
      .map((o) => ({
        item_kind: o.item_kind as PublicPriceOverride["item_kind"],
        item_code: o.item_code,
        currency_code: o.currency_code,
        amount_minor: Number(o.amount_minor),
      }));
  },
);
