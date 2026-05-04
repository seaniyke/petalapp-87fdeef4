/**
 * Runtime wallet — server-side helpers for the new pay-as-you-go cloud + AI
 * meter that runs ALONGSIDE the existing build-credit subscription system.
 *
 * - charge_runtime: drains free balance first, then top-up. Enforces per-project
 *   and per-workspace spend caps. On project cap hit, also flips
 *   `projects.runtime_paused = true`.
 * - credit_runtime: top-ups + monthly free grant.
 * - getRuntimeBalance / getRuntimeBreakdown: reads for the UI.
 *
 * All amounts are USD cents (BIGINT in DB) so we never deal with floats.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RuntimeMeter =
  | "backend_hour"
  | "image_gen"
  | "app_ai"
  | "domain"
  | "mobile_build"
  | "topup"
  | "free_grant"
  | "admin_adjust";

export type ChargeRuntimeOptions = {
  userId: string;
  projectId?: string | null;
  meter: RuntimeMeter;
  cents: number;
  metadata?: Record<string, unknown>;
};

export type ChargeRuntimeResult =
  | { ok: true; freeAfter: number; topupAfter: number }
  | {
      ok: false;
      reason:
        | "insufficient_balance"
        | "project_cap_exceeded"
        | "workspace_cap_exceeded"
        | "internal_error";
      freeAfter: number;
      topupAfter: number;
      message?: string;
    };

/** Atomically charge the runtime wallet. Returns ok:false with a reason
 *  the caller can surface — never throws on cap/balance issues. */
export async function chargeRuntime(opts: ChargeRuntimeOptions): Promise<ChargeRuntimeResult> {
  if (!Number.isFinite(opts.cents) || opts.cents <= 0) {
    return { ok: true, freeAfter: 0, topupAfter: 0 };
  }
  const cents = Math.round(opts.cents);
  try {
    const { data, error } = await supabaseAdmin.rpc("charge_runtime", {
      _user_id: opts.userId,
      _project_id: opts.projectId ?? (null as never),
      _meter: opts.meter,
      _amount_cents: cents as never,
      _metadata: (opts.metadata as never) ?? {},
    });
    if (error) {
      console.error("[runtime-wallet] charge_runtime RPC error", error);
      return {
        ok: false,
        reason: "internal_error",
        freeAfter: 0,
        topupAfter: 0,
        message: error.message,
      };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const free = Number(row?.free_after ?? 0);
    const topup = Number(row?.topup_after ?? 0);
    if (row?.ok) {
      return { ok: true, freeAfter: free, topupAfter: topup };
    }
    const reason = (row?.reason ?? "insufficient_balance") as
      | "insufficient_balance"
      | "project_cap_exceeded"
      | "workspace_cap_exceeded";
    return { ok: false, reason, freeAfter: free, topupAfter: topup };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[runtime-wallet] charge_runtime threw", e);
    return { ok: false, reason: "internal_error", freeAfter: 0, topupAfter: 0, message };
  }
}

export type RuntimeBalance = {
  freeBalanceCents: number;
  topupBalanceCents: number;
  freeResetAt: string; // ISO date
  workspaceCapCents: number | null;
  monthlyFreeGrantCents: number; // currently $5 = 500
};

export async function getRuntimeBalance(userId: string): Promise<RuntimeBalance> {
  const { data } = await supabaseAdmin
    .from("user_wallets")
    .select(
      "runtime_free_balance_cents, runtime_topup_balance_cents, runtime_free_reset_at, workspace_cap_cents",
    )
    .eq("user_id", userId)
    .maybeSingle();

  return {
    freeBalanceCents: Number(data?.runtime_free_balance_cents ?? 0),
    topupBalanceCents: Number(data?.runtime_topup_balance_cents ?? 0),
    freeResetAt:
      data?.runtime_free_reset_at ??
      new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    workspaceCapCents:
      data?.workspace_cap_cents == null ? null : Number(data.workspace_cap_cents),
    monthlyFreeGrantCents: 500,
  };
}

export type ProjectUsage = {
  projectId: string;
  title: string;
  spentCents: number;
  capCents: number | null;
  paused: boolean;
};

/** Month-to-date usage per project the user owns. */
export async function getRuntimeProjectBreakdown(userId: string): Promise<ProjectUsage[]> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, title, spend_cap_cents, runtime_paused")
    .eq("owner_id", userId);

  if (!projects?.length) return [];

  const { data: ledger } = await supabaseAdmin
    .from("runtime_ledger")
    .select("project_id, delta_cents")
    .eq("user_id", userId)
    .lt("delta_cents", 0)
    .gte("created_at", startOfMonth.toISOString());

  const spent = new Map<string, number>();
  for (const row of ledger ?? []) {
    if (!row.project_id) continue;
    spent.set(row.project_id, (spent.get(row.project_id) ?? 0) + Math.abs(Number(row.delta_cents)));
  }

  return projects.map((p) => ({
    projectId: p.id,
    title: p.title ?? "Untitled",
    spentCents: spent.get(p.id) ?? 0,
    capCents: p.spend_cap_cents == null ? null : Number(p.spend_cap_cents),
    paused: !!p.runtime_paused,
  }));
}

/** Workspace month-to-date totals split into Cloud vs AI buckets. */
export async function getRuntimeUsageSplit(userId: string): Promise<{
  cloudCents: number;
  aiCents: number;
}> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { data } = await supabaseAdmin
    .from("runtime_ledger")
    .select("meter, delta_cents")
    .eq("user_id", userId)
    .lt("delta_cents", 0)
    .gte("created_at", startOfMonth.toISOString());

  let cloud = 0;
  let ai = 0;
  for (const row of data ?? []) {
    const amt = Math.abs(Number(row.delta_cents));
    if (row.meter === "app_ai" || row.meter === "image_gen") ai += amt;
    else if (row.meter === "backend_hour" || row.meter === "domain") cloud += amt;
  }
  return { cloudCents: cloud, aiCents: ai };
}
