/**
 * Kimble Cloud metering: provider usage → cost ledger → credits.
 *
 * One path for every cloud resource:
 *   measure usage → price at provider rate (ACTUAL / ESTIMATED / ALLOCATED /
 *   UNKNOWN) → `cost_events` rows → customer price via `cloud-pricing` →
 *   `chargeRuntime` (the single credit balance).
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  priceExternal,
  priceShared,
  railwayCosts,
  supabaseCosts,
  type CloudRates,
  type PricedCharge,
  type RailwayUsage,
  type ResourceCost,
} from "@/lib/cloud-pricing";
import { recordCostEvents, type CostCategory } from "@/server/cost-events.server";
import { cloudRates } from "@/server/economics-config.server";
import { chargeRuntime, type ChargeRuntimeResult, type RuntimeMeter } from "@/server/runtime-wallet.server";

const CATEGORY: Record<string, CostCategory> = {
  railway_cpu: "BUILD_COMPUTE",
  railway_ram: "BUILD_COMPUTE",
  railway_storage: "STORAGE",
  railway_egress: "NETWORK",
  supabase_compute: "DATABASE",
  supabase_disk: "STORAGE",
  supabase_egress: "NETWORK",
  cloud_shared: "DATABASE",
};
const PROVIDER: Record<string, string> = {
  railway: "railway",
  supabase: "supabase",
  cloud: "kimble_shared",
};

/* ---------------- Railway ---------------- */

const USAGE_QUERY = `
  query KimbleComputeUsage($projectId: String!, $start: DateTime!, $end: DateTime!) {
    usage(
      projectId: $projectId
      startDate: $start
      endDate: $end
      groupBy: [SERVICE_ID]
      measurements: [CPU_USAGE, MEMORY_USAGE_GB, DISK_USAGE_GB, NETWORK_TX_GB]
    ) { measurement value tags { serviceId } }
  }
`;

/** Parse Railway `usage` rows for one service. Values: vCPU-min, GB-min, GB-min, GB. */
export function parseRailwayUsage(
  rows: Array<{ measurement: string; value: number; tags?: { serviceId?: string | null } }>,
  serviceId: string,
): RailwayUsage {
  const u: RailwayUsage = { cpuVcpuMinutes: 0, memoryGbMinutes: 0, diskGbMinutes: 0, egressGb: 0 };
  for (const r of rows) {
    if (r.tags?.serviceId !== serviceId) continue;
    const v = Number(r.value) || 0;
    if (r.measurement === "CPU_USAGE") u.cpuVcpuMinutes += v;
    else if (r.measurement === "MEMORY_USAGE_GB") u.memoryGbMinutes += v;
    else if (r.measurement === "DISK_USAGE_GB") u.diskGbMinutes += v;
    else if (r.measurement === "NETWORK_TX_GB") u.egressGb += v;
  }
  return u;
}

export async function readRailwayUsage(
  serviceId: string,
  fromIso: string,
  toIso: string,
): Promise<RailwayUsage | null> {
  try {
    const { readComputeConfig, railwayGraphql } = await import("@/server/railway.server");
    const cfg = readComputeConfig();
    if (cfg.missing.length) return null;
    const data = await railwayGraphql<{
      usage: Array<{ measurement: string; value: number; tags?: { serviceId?: string | null } }>;
    }>(cfg.token, USAGE_QUERY, { projectId: cfg.projectId, start: fromIso, end: toIso });
    return parseRailwayUsage(data.usage ?? [], serviceId);
  } catch (err) {
    console.warn("[cloud-metering] railway usage read failed", serviceId, err);
    return null;
  }
}

/** Railway cost for a window: measured (ACTUAL) or the configured hourly estimate. */
export function railwayWindowCosts(usage: RailwayUsage | null, hours: number, r: CloudRates): ResourceCost[] {
  if (usage) return railwayCosts(usage, r);
  return [
    {
      resource: "railway_cpu",
      quantity: hours,
      unit: "awake_hours",
      costUsd: Math.round(r.railwayFallbackHourUsd * hours * 1e6) / 1e6,
      basis: "ESTIMATED",
    },
  ];
}

/* ---------------- Dedicated database ---------------- */

export async function dedicatedWindowCosts(ref: string | null, hours: number, r: CloudRates): Promise<ResourceCost[]> {
  let rate: number | null = null;
  let fromProvider = false;
  let diskGb: number | null = null;
  if (ref) {
    const mgmt = await import("@/server/supabase-mgmt.server");
    try {
      const cr = await mgmt.getComputeRate(ref);
      if (cr) {
        rate = cr.hourUsd;
        fromProvider = true;
      }
    } catch (err) {
      console.warn("[cloud-metering] compute rate read failed", ref, err);
    }
    try {
      const rows = (await mgmt.runQuery(ref, "select pg_database_size(current_database())::bigint as b")) as Array<{ b?: number | string }>;
      const b = Number(rows[0]?.b);
      if (Number.isFinite(b)) diskGb = b / 1024 ** 3;
    } catch (err) {
      console.warn("[cloud-metering] disk size read failed", ref, err);
    }
  }
  return supabaseCosts({ hours, computeHourUsd: rate, computeFromProvider: fromProvider, diskGb }, r);
}

/* ---------------- Shared Cloud ---------------- */

export async function sharedWindowPrice(projectId: string, hours: number, r: CloudRates): Promise<PricedCharge> {
  const [{ count: projectRows }, { count: totalRows }, { data: bill }] = await Promise.all([
    supabaseAdmin.from("shared_app_records").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabaseAdmin.from("shared_app_records").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("infra_services").select("monthly_fixed_usd").eq("service", "Database / backend").maybeSingle(),
  ]);
  const raw = (bill as { monthly_fixed_usd?: number | string | null } | null)?.monthly_fixed_usd;
  const monthly = raw == null ? null : Number(raw);
  const base = priceShared(
    {
      hours,
      projectRows: projectRows ?? 0,
      totalRows: totalRows ?? 0,
      sharedMonthlyBillUsd: monthly != null && Number.isFinite(monthly) ? monthly : null,
    },
    r,
  );
  // Customer price is the flat Shared Cloud rate per active day; the cost
  // allocation above stays as-is for margin reporting.
  const { economicsValues } = await import("@/server/economics-config.server");
  const v = await economicsValues();
  return applyFlatSharedRate(base, hours, v.cloud_shared_daily_credits, v.credit_retail_usd_cents / 100);
}

/** Flat Shared Cloud price: `dailyCredits` per 24 active hours. */
export function applyFlatSharedRate(
  base: PricedCharge,
  hours: number,
  dailyCredits: number,
  usdPerCredit: number,
): PricedCharge {
  if (!(dailyCredits > 0)) return base;
  const credits = Math.round(dailyCredits * (hours / 24) * 10_000) / 10_000;
  const priceUsd = Math.round(credits * usdPerCredit * 1_000_000) / 1_000_000;
  const cost = base.costs[0]?.costUsd ?? null;
  return {
    ...base,
    credits,
    priceUsd,
    marginPct: cost == null || priceUsd <= 0 ? null : Math.round(((priceUsd - cost) / priceUsd) * 10_000) / 100,
  };
}

/* ---------------- Charge + ledger ---------------- */

/**
 * Record each resource cost and charge the customer's credits once.
 * `ref` makes the cost rows idempotent per window.
 */
export async function chargeCloud(opts: {
  userId: string;
  projectId: string;
  meter: RuntimeMeter;
  provider: keyof typeof PROVIDER;
  windowRef: string;
  priced: PricedCharge;
  metadata?: Record<string, unknown>;
}): Promise<ChargeRuntimeResult> {
  const { priced } = opts;
  if (priced.credits <= 0) return { ok: true, freeAfter: 0, topupAfter: 0, paidWithCredits: 0 };
  // Idempotent per window: a re-run of the same cron never charges twice.
  const firstRef = `cloud:${opts.windowRef}:${priced.costs[0]?.resource ?? "x"}`;
  const { data: seen } = await supabaseAdmin
    .from("cost_events" as never)
    .select("id")
    .eq("source_ref", firstRef)
    .maybeSingle();
  if (seen) return { ok: true, freeAfter: 0, topupAfter: 0, paidWithCredits: 0 };
  const charge = await chargeRuntime({
    userId: opts.userId,
    projectId: opts.projectId,
    meter: opts.meter,
    cents: Math.max(1, Math.round(priced.priceUsd * 100)),
    credits: priced.credits,
    metadata: {
      ...(opts.metadata ?? {}),
      label: "Cloud usage",
      cloud_price_usd: priced.priceUsd,
      cloud_known_cost_usd: priced.knownCostUsd,
      cloud_margin_pct: priced.marginPct,
    },
  });
  // Cost is Kimble's whether or not the customer could pay; record it always.
  await recordCostEvents(
    priced.costs.map((c) => ({
      sourceRef: `cloud:${opts.windowRef}:${c.resource}`,
      userId: opts.userId,
      projectId: opts.projectId,
      stage: "cloud_usage",
      category: CATEGORY[c.resource] ?? "OTHER_VARIABLE",
      provider: PROVIDER[opts.provider],
      resource: c.resource,
      quantity: c.quantity,
      unit: c.unit,
      costUsd: c.costUsd,
      basis: c.basis,
      metadata: {
        credits_charged: charge.ok ? priced.credits : 0,
        customer_price_usd: priced.priceUsd,
        charge_ok: charge.ok,
      },
    })),
  );
  return charge;
}

export { cloudRates, priceExternal };
