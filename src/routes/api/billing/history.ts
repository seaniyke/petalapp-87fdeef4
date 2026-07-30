/**
 * GET /api/billing/history
 *
 * One call that powers the billing dashboard: plan + subscription state,
 * credit balances, Cloud + AI balance, and a merged payment history of card
 * (Paystack) and crypto payments — newest first.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BillingHistoryItem = {
  id: string;
  method: "card" | "crypto";
  reference: string;
  purpose: string;
  itemCode: string;
  usdAmountCents: number;
  displayAmountMinor: number | null;
  currencyCode: string;
  status: string;
  asset: string | null;
  chain: string | null;
  txHash: string | null;
  confirmations: number | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
};

export const Route = createFileRoute("/api/billing/history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const { data: userData } = await supabaseAdmin.auth.getUser(auth.slice(7));
        const user = userData.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const [walletRes, subRes, cardRes, cryptoRes] = await Promise.all([
          supabaseAdmin
            .from("user_wallets")
            .select(
              "plan_code, monthly_credits_remaining, topup_credits_remaining, daily_free_used, monthly_free_used, subscription_status, current_period_end, preferred_currency, runtime_free_balance_cents, runtime_topup_balance_cents",
            )
            .eq("user_id", user.id)
            .maybeSingle(),
          supabaseAdmin
            .from("subscriptions")
            .select("status, cancel_at_period_end, next_payment_date, plan_code")
            .eq("user_id", user.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabaseAdmin
            .from("paystack_transactions")
            .select(
              "id, reference, status, amount_minor, currency_code, usd_amount_cents, purpose, item_code, created_at, paid_at",
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabaseAdmin
            .from("crypto_payments" as never)
            .select(
              "id, reference, purpose, item_code, usd_amount_cents, asset, chain, tx_hash, status, confirmations, verify_note, admin_note, created_at, credited_at",
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);

        const card = (cardRes.data ?? []).map(
          (t): BillingHistoryItem => ({
            id: String(t.id),
            method: "card",
            reference: t.reference,
            purpose: t.purpose ?? "plan",
            itemCode: t.item_code ?? "",
            usdAmountCents: Number(t.usd_amount_cents ?? 0),
            displayAmountMinor: t.amount_minor == null ? null : Number(t.amount_minor),
            currencyCode: t.currency_code ?? "USD",
            status: t.status ?? "pending",
            asset: null,
            chain: null,
            txHash: null,
            confirmations: null,
            note: null,
            createdAt: t.created_at,
            paidAt: t.paid_at ?? null,
          }),
        );

        const crypto = ((cryptoRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(
          (t): BillingHistoryItem => ({
            id: String(t.id),
            method: "crypto",
            reference: String(t.reference),
            purpose: String(t.purpose ?? "plan"),
            itemCode: String(t.item_code ?? ""),
            usdAmountCents: Number(t.usd_amount_cents ?? 0),
            displayAmountMinor: null,
            currencyCode: "USD",
            status: String(t.status ?? "pending"),
            asset: (t.asset as string) ?? null,
            chain: (t.chain as string) ?? null,
            txHash: (t.tx_hash as string) ?? null,
            confirmations: t.confirmations == null ? null : Number(t.confirmations),
            note: (t.verify_note as string) ?? (t.admin_note as string) ?? null,
            createdAt: String(t.created_at),
            paidAt: (t.credited_at as string) ?? null,
          }),
        );

        const items = [...card, ...crypto].sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
        );

        return Response.json({
          email: user.email ?? null,
          wallet: walletRes.data ?? null,
          subscription: subRes.data ?? null,
          items,
        });
      },
    },
  },
});
