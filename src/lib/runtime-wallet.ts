/**
 * Client-side helpers for the runtime wallet ("Cloud + AI balance").
 *
 * The runtime wallet is denominated in USD cents and is SEPARATE from the
 * build-credit system in `billing.ts`. Cloud + AI is pure pay-as-you-go:
 * users top up via Paystack and the balance never expires. There is no
 * monthly free $ grant for Cloud or AI.
 */
import { supabase } from "@/integrations/supabase/client";

export type RuntimeWallet = {
  freeBalanceCents: number;
  topupBalanceCents: number;
  freeResetAt: string; // YYYY-MM-DD
  workspaceCapCents: number | null;
  monthlyFreeGrantCents: number; // currently 500 ($5) once qualified
  qualifiedForFreeGrant: boolean;
  qualifiedAt: string | null;
};

export type RuntimeTopupPack = {
  code: string;
  label: string;
  amount_cents: number;
  currency_code: string;
  display_amount_minor: number;
  sort_order: number;
};

export type ProjectUsageRow = {
  projectId: string;
  title: string;
  spentCents: number;
  capCents: number | null;
  paused: boolean;
};

export type RuntimeUsageSplit = {
  cloudCents: number;
  aiCents: number;
};

const MONTHLY_FREE_GRANT_CENTS = 500;

export async function fetchRuntimeWallet(userId: string): Promise<RuntimeWallet> {
  const { data } = await supabase
    .from("user_wallets")
    .select(
      "runtime_free_balance_cents, runtime_topup_balance_cents, runtime_free_reset_at, workspace_cap_cents, runtime_topup_qualified_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const nextReset = new Date();
  nextReset.setUTCDate(1);
  nextReset.setUTCMonth(nextReset.getUTCMonth() + 1);

  const qualifiedAt = (data as { runtime_topup_qualified_at?: string | null } | null)
    ?.runtime_topup_qualified_at ?? null;

  return {
    freeBalanceCents: Number(data?.runtime_free_balance_cents ?? 0),
    topupBalanceCents: Number(data?.runtime_topup_balance_cents ?? 0),
    freeResetAt: data?.runtime_free_reset_at ?? nextReset.toISOString().slice(0, 10),
    workspaceCapCents:
      data?.workspace_cap_cents == null ? null : Number(data.workspace_cap_cents),
    monthlyFreeGrantCents: MONTHLY_FREE_GRANT_CENTS,
    qualifiedForFreeGrant: qualifiedAt !== null,
    qualifiedAt,
  };
}

export async function fetchRuntimeTopupPacks(): Promise<RuntimeTopupPack[]> {
  const { data, error } = await supabase
    .from("runtime_topup_packs")
    .select("code, label, amount_cents, currency_code, display_amount_minor, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    ...p,
    amount_cents: Number(p.amount_cents),
    display_amount_minor: Number(p.display_amount_minor),
  })) as RuntimeTopupPack[];
}

export async function fetchProjectUsage(userId: string): Promise<ProjectUsageRow[]> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, spend_cap_cents, runtime_paused")
    .eq("owner_id", userId);
  if (!projects?.length) return [];

  const { data: ledger } = await supabase
    .from("runtime_ledger")
    .select("project_id, delta_cents")
    .eq("user_id", userId)
    .lt("delta_cents", 0)
    .gte("created_at", startOfMonth.toISOString());

  const spent = new Map<string, number>();
  for (const r of ledger ?? []) {
    if (!r.project_id) continue;
    spent.set(r.project_id, (spent.get(r.project_id) ?? 0) + Math.abs(Number(r.delta_cents)));
  }

  return projects.map((p) => ({
    projectId: p.id,
    title: p.title ?? "Untitled",
    spentCents: spent.get(p.id) ?? 0,
    capCents: p.spend_cap_cents == null ? null : Number(p.spend_cap_cents),
    paused: !!p.runtime_paused,
  }));
}

export async function fetchRuntimeUsageSplit(userId: string): Promise<RuntimeUsageSplit> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("runtime_ledger")
    .select("meter, delta_cents")
    .eq("user_id", userId)
    .lt("delta_cents", 0)
    .gte("created_at", startOfMonth.toISOString());

  let cloudCents = 0;
  let aiCents = 0;
  for (const r of data ?? []) {
    const amt = Math.abs(Number(r.delta_cents));
    // AI meters are explicit; everything else (backend hours, domains, storage,
    // egress, future meters) counts as Cloud so no spend goes unreported.
    if (r.meter === "app_ai" || r.meter === "image_gen") aiCents += amt;
    else cloudCents += amt;
  }
  return { cloudCents, aiCents };

}

/** Format USD cents as "$X.XX" / "$X" if whole dollar. */
export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars.toFixed(0)}`;
  return `$${dollars.toFixed(2)}`;
}

/** Update a project's spend cap. Pass null to clear. */
export async function setProjectSpendCap(
  projectId: string,
  capCents: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({
      spend_cap_cents: capCents,
      // Clear pause flag when cap is raised/cleared
      runtime_paused: false,
    })
    .eq("id", projectId);
  if (error) throw error;
}

/** Update workspace-level cap. Pass null to clear. */
export async function setWorkspaceCap(
  userId: string,
  capCents: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("user_wallets")
    .update({ workspace_cap_cents: capCents })
    .eq("user_id", userId);
  if (error) throw error;
}

/** Initiate a runtime top-up — either a fixed pack or a custom amount. */
export async function initiateRuntimeTopup(args: {
  packCode?: string; // for fixed packs
  customAmountMinor?: number; // for custom amount
  currency: string;
  returnUrl: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const itemCode = args.packCode ?? "custom";
  const res = await fetch("/api/billing/initialize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      purpose: "runtime_topup",
      itemCode,
      currency: args.currency,
      returnUrl: args.returnUrl,
      customAmountMinor: args.customAmountMinor,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try {
      const j = JSON.parse(txt);
      msg = j.error || msg;
    } catch {
      /* keep raw */
    }
    throw new Error(msg || `Top-up failed (${res.status})`);
  }
  return res.json() as Promise<{ authorizationUrl: string; reference: string }>;
}
