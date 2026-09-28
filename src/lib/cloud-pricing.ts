/**
 * Kimble Cloud pricing — the single formula from provider cost to credits.
 *
 * Pure: no I/O. Rates come from `economics_config` via the caller.
 *
 *   dedicated / external price = provider cost / (1 − margin)     (gross margin, NOT markup)
 *   shared price               = equivalent dedicated price × (1 − shared discount)
 *   credits                    = customer price / revenue per credit
 *
 * $10 of provider cost at a 30% margin → $14.29 customer price.
 * Shared benchmark at 50% discount → $7.14.
 */

export type CloudRates = {
  /** Target gross margin on external infrastructure, percent (30). */
  externalMarginPct: number;
  /** Shared Cloud discount off the equivalent dedicated price, percent (50). */
  sharedDiscountPct: number;
  /** What a customer pays for one credit, USD. */
  revenuePerCreditUsd: number;
  /** Supabase compute hourly rate used when the provider does not report one. */
  supabaseMicroHourUsd: number;
  supabaseDiskGbMonthUsd: number;
  supabaseIncludedDiskGb: number;
  railwayCpuVcpuMinUsd: number;
  railwayRamGbMinUsd: number;
  railwayDiskGbMinUsd: number;
  railwayEgressGbUsd: number;
  /** Estimated Railway cost per awake hour when usage cannot be read. */
  railwayFallbackHourUsd: number;
};

export const CLOUD_RATE_DEFAULTS: CloudRates = {
  externalMarginPct: 30,
  sharedDiscountPct: 50,
  revenuePerCreditUsd: 0.13,
  // Supabase published compute rates (docs: Compute and Disk).
  supabaseMicroHourUsd: 0.01344,
  supabaseDiskGbMonthUsd: 0.125,
  supabaseIncludedDiskGb: 8,
  // Railway published per-minute rates (docs: pricing).
  railwayCpuVcpuMinUsd: 0.000463,
  railwayRamGbMinUsd: 0.000231,
  railwayDiskGbMinUsd: 0.15 / (30 * 24 * 60),
  railwayEgressGbUsd: 0.05,
  railwayFallbackHourUsd: 0.03,
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Customer price for an external provider cost at the target gross margin. */
export function externalPriceUsd(costUsd: number, marginPct: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  const m = Math.min(Math.max(marginPct, 0), 95) / 100;
  return round6(costUsd / (1 - m));
}

/** Shared Cloud price: the equivalent dedicated customer price, discounted. */
export function sharedPriceUsd(equivalentDedicatedPriceUsd: number, discountPct: number): number {
  if (!Number.isFinite(equivalentDedicatedPriceUsd) || equivalentDedicatedPriceUsd <= 0) return 0;
  const d = Math.min(Math.max(discountPct, 0), 95) / 100;
  return round6(equivalentDedicatedPriceUsd * (1 - d));
}

/** Customer USD → Kimble credits, rounded up to 0.0001 so tiny ticks are never free. */
export function usdToCredits(priceUsd: number, revenuePerCreditUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || revenuePerCreditUsd <= 0) return 0;
  return Math.ceil((priceUsd / revenuePerCreditUsd) * 10_000) / 10_000;
}

/** Gross margin actually achieved, percent. Null when cost is unknown. */
export function grossMarginPct(priceUsd: number, costUsd: number | null): number | null {
  if (costUsd == null || priceUsd <= 0) return null;
  return Math.round(((priceUsd - costUsd) / priceUsd) * 10_000) / 100;
}

export type RailwayUsage = {
  cpuVcpuMinutes: number;
  memoryGbMinutes: number;
  diskGbMinutes: number;
  egressGb: number;
};

export type ResourceCost = {
  resource: string;
  quantity: number | null;
  unit: string;
  costUsd: number | null;
  basis: "ACTUAL" | "ESTIMATED" | "ALLOCATED" | "UNKNOWN";
};

/** Measured Railway usage priced at Railway's published rates (ACTUAL). */
export function railwayCosts(u: RailwayUsage, r: CloudRates): ResourceCost[] {
  return [
    { resource: "railway_cpu", quantity: u.cpuVcpuMinutes, unit: "vcpu_minutes", costUsd: round6(u.cpuVcpuMinutes * r.railwayCpuVcpuMinUsd), basis: "ACTUAL" },
    { resource: "railway_ram", quantity: u.memoryGbMinutes, unit: "gb_minutes", costUsd: round6(u.memoryGbMinutes * r.railwayRamGbMinUsd), basis: "ACTUAL" },
    { resource: "railway_storage", quantity: u.diskGbMinutes, unit: "gb_minutes", costUsd: round6(u.diskGbMinutes * r.railwayDiskGbMinUsd), basis: "ACTUAL" },
    { resource: "railway_egress", quantity: u.egressGb, unit: "gb", costUsd: round6(u.egressGb * r.railwayEgressGbUsd), basis: "ACTUAL" },
  ];
}

/** Dedicated database cost for `hours` of runtime. */
export function supabaseCosts(
  args: { hours: number; computeHourUsd: number | null; computeFromProvider: boolean; diskGb: number | null },
  r: CloudRates,
): ResourceCost[] {
  const hourly = args.computeHourUsd ?? r.supabaseMicroHourUsd;
  const overGb = args.diskGb == null ? null : Math.max(0, args.diskGb - r.supabaseIncludedDiskGb);
  return [
    {
      resource: "supabase_compute",
      quantity: args.hours,
      unit: "hours",
      costUsd: round6(hourly * args.hours),
      // The provider's stated rate × measured hours: a rate-derived estimate.
      basis: "ESTIMATED",
    },
    {
      resource: "supabase_disk",
      quantity: args.diskGb,
      unit: "gb",
      costUsd: overGb == null ? null : round6((overGb * r.supabaseDiskGbMonthUsd * args.hours) / 730),
      basis: overGb == null ? "UNKNOWN" : "ESTIMATED",
    },
    { resource: "supabase_egress", quantity: null, unit: "gb", costUsd: null, basis: "UNKNOWN" },
  ];
}

export type PricedCharge = {
  costs: ResourceCost[];
  knownCostUsd: number;
  priceUsd: number;
  credits: number;
  marginPct: number | null;
};

/** Price a set of external resource costs: sum known costs, apply margin, convert. */
export function priceExternal(costs: ResourceCost[], r: CloudRates): PricedCharge {
  const known = round6(costs.reduce((s, c) => s + (c.costUsd ?? 0), 0));
  const priceUsd = externalPriceUsd(known, r.externalMarginPct);
  return {
    costs,
    knownCostUsd: known,
    priceUsd,
    credits: usdToCredits(priceUsd, r.revenuePerCreditUsd),
    marginPct: grossMarginPct(priceUsd, known),
  };
}

/**
 * Shared Cloud for `hours` of an active app: 50% below what the same app would
 * pay on the smallest dedicated database. Cost is ALLOCATED from Kimble's
 * shared bill by the project's share of stored rows, or UNKNOWN when no bill
 * is entered — never invented.
 */
export function priceShared(
  args: { hours: number; projectRows: number; totalRows: number; sharedMonthlyBillUsd: number | null },
  r: CloudRates,
): PricedCharge {
  const dedicatedEquivalent = externalPriceUsd(r.supabaseMicroHourUsd * args.hours, r.externalMarginPct);
  const priceUsd = sharedPriceUsd(dedicatedEquivalent, r.sharedDiscountPct);
  let cost: number | null = null;
  if (args.sharedMonthlyBillUsd != null && args.sharedMonthlyBillUsd >= 0 && args.totalRows > 0) {
    const share = Math.max(0, args.projectRows) / args.totalRows;
    cost = round6((args.sharedMonthlyBillUsd * share * args.hours) / 730);
  }
  const costs: ResourceCost[] = [
    { resource: "cloud_shared", quantity: args.projectRows, unit: "rows", costUsd: cost, basis: cost == null ? "UNKNOWN" : "ALLOCATED" },
  ];
  return {
    costs,
    knownCostUsd: cost ?? 0,
    priceUsd,
    credits: usdToCredits(priceUsd, r.revenuePerCreditUsd),
    marginPct: grossMarginPct(priceUsd, cost),
  };
}
