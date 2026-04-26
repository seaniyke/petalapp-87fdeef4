/**
 * useWallet — subscribes to the current user's wallet row and the plan catalog.
 *
 * Returns balance breakdown that auto-updates when the server grants/spends
 * credits (via Postgres realtime on user_wallets). Used by the header credit
 * badge and the billing sheet.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  computeBreakdown,
  fetchPlans,
  fetchWallet,
  type CreditBreakdown,
  type Plan,
  type Wallet,
} from "@/lib/billing";

export type UseWalletResult = {
  wallet: Wallet | null;
  plan: Plan | null;
  plans: Plan[];
  breakdown: CreditBreakdown;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useWallet(): UseWalletResult {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user) {
      setWallet(null);
      setLoading(false);
      return;
    }
    const [w, p] = await Promise.all([fetchWallet(user.id), fetchPlans()]);
    setWallet(w);
    setPlans(p);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!user) {
      setWallet(null);
      setPlans([]);
      setLoading(false);
      return;
    }
    Promise.all([fetchWallet(user.id), fetchPlans()])
      .then(([w, p]) => {
        if (cancelled) return;
        setWallet(w);
        setPlans(p);
      })
      .catch((e) => {
        // Non-fatal — header badge just won't render.
        console.warn("[useWallet] fetch failed", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Realtime: any UPDATE/INSERT on this user's wallet row updates the badge.
    const channel = supabase
      .channel(`wallet:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_wallets",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new) setWallet(payload.new as Wallet);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const plan = wallet ? plans.find((p) => p.code === wallet.plan_code) ?? null : null;
  const breakdown = computeBreakdown(wallet, plan);

  return { wallet, plan, plans, breakdown, loading, refresh };
}
