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
  | { ok: true; freeAfter: number; topupAfter: number; paidWithCredits?: number }
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

/** Charge a Cloud/AI meter to the single Petal Credits balance.
 *
 *  Order of operations:
 *    1. spend caps (project + workspace) are checked first — a cap is a
 *       deliberate ceiling and always blocks, whatever the balance is;
 *    2. the meter cost in cents is converted to credits at the central rate
 *       and charged to the credit balance;
 *    3. the meter tick is recorded in `runtime_ledger` in cents so per-meter,
 *       per-project economics, caps and the admin dashboard keep working.
 *
 *  Never throws on cap/balance issues — returns ok:false with a reason. */
export async function chargeRuntime(opts: ChargeRuntimeOptions): Promise<ChargeRuntimeResult> {
  if (!Number.isFinite(opts.cents) || opts.cents <= 0) {
    console.warn("[runtime-wallet] ignoring non-positive charge", {
      meter: opts.meter,
      cents: opts.cents,
    });
    return { ok: true, freeAfter: 0, topupAfter: 0 };
  }
  const cents = Math.round(opts.cents);
  try {
    const { data: capData, error: capError } = await supabaseAdmin.rpc("runtime_cap_check", {
      _user_id: opts.userId,
      _project_id: opts.projectId ?? (null as never),
      _amount_cents: cents as never,
    });
    if (capError) {
      console.error("[runtime-wallet] runtime_cap_check RPC error", capError);
      return {
        ok: false,
        reason: "internal_error",
        freeAfter: 0,
        topupAfter: 0,
        message: capError.message,
      };
    }
    const capRow = Array.isArray(capData) ? capData[0] : capData;
    if (capRow && capRow.ok === false) {
      const reason = (capRow.reason ?? "workspace_cap_exceeded") as
        | "project_cap_exceeded"
        | "workspace_cap_exceeded";
      return { ok: false, reason, freeAfter: 0, topupAfter: 0 };
    }

    const { centsToCredits } = await import("@/server/runtime-credit-fallback.server");
    const { spendCredit } = await import("@/server/credits.server");
    const credits = await centsToCredits(cents);
    const spend = await spendCredit({
      userId: opts.userId,
      amount: credits,
      reason: "runtime_charge",
      projectId: opts.projectId ?? null,
      metadata: {
        ...(opts.metadata ?? {}),
        runtime_meter: opts.meter,
        runtime_cents: cents,
      },
    });
    if (!spend.ok) {
      if (spend.reason === "insufficient_credits") {
        // Keep the existing 48h grace behaviour so a project isn't killed the
        // moment a balance runs out.
        if (opts.projectId) {
          await supabaseAdmin
            .from("projects")
            .update({ runtime_grace_until: new Date(Date.now() + 48 * 3600_000).toISOString() })
            .eq("id", opts.projectId)
            .is("runtime_grace_until", null);
        }
        return { ok: false, reason: "insufficient_balance", freeAfter: 0, topupAfter: 0 };
      }
      return {
        ok: false,
        reason: "internal_error",
        freeAfter: 0,
        topupAfter: 0,
        message: spend.message,
      };
    }

    // Usage record in cents — the source of truth for economics and caps.
    await supabaseAdmin.from("runtime_ledger").insert({
      user_id: opts.userId,
      project_id: opts.projectId ?? null,
      meter: opts.meter,
      delta_cents: -cents,
      free_after_cents: 0,
      topup_after_cents: 0,
      metadata: {
        ...(opts.metadata ?? {}),
        paid_with_credits: credits,
        credit_ledger_id: spend.ledgerId,
      } as never,
    });

    if (opts.projectId) {
      await supabaseAdmin
        .from("projects")
        .update({ runtime_grace_until: null })
        .eq("id", opts.projectId)
        .not("runtime_grace_until", "is", null);
    }

    return { ok: true, freeAfter: 0, topupAfter: 0, paidWithCredits: credits };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[runtime-wallet] chargeRuntime threw", e);
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
