/**
 * THE customer price authority: Kimble Effort Pricing. Pure functions only.
 *
 * Customer price = effort curve over PRODUCTIVE work Kimble did.
 * Internal cost  = saved per-step AI costs (build-pricing.ts). The two are
 * never mixed: AI cost never feeds the price; the price never feeds the
 * spending limit. The model never reports its own effort.
 *
 * Every weight is configurable via economics_config keys `effort_*`.
 */
import type { ExecutionClass } from "@/server/execution/complexity";

export type EffortWeights = {
  /** Fixed cost of understanding any request (reading, deciding). */
  base: number;
  /** A new file is the largest unit of authored work. */
  fileCreated: number;
  /** Editing an existing file: less than creating one. */
  fileModified: number;
  /** Removing a file: small, but real. */
  fileDeleted: number;
  /** Per changed line — measures surface, not files. */
  perLine: number;
  /** Lines counted per file at most, so one huge file can't dominate. */
  lineCapPerFile: number;
  /** A page/route is a whole user-facing surface on top of its file. */
  page: number;
  /** Backend, database, sign-in, integration or payment work each. */
  capability: number;
  /** Per passing verification cycle (capped). */
  validation: number;
  validationCap: number;
  /** Per minute of wall time, hard-capped: slow infra can't raise prices. */
  perMinute: number;
  minuteCap: number;
};

export const DEFAULT_EFFORT_WEIGHTS: EffortWeights = {
  base: 0.5,
  fileCreated: 1,
  fileModified: 0.6,
  fileDeleted: 0.2,
  perLine: 0.004,
  lineCapPerFile: 300,
  page: 1.5,
  capability: 2,
  validation: 0.2,
  validationCap: 10,
  perMinute: 0.1,
  minuteCap: 1,
};

/** Class nudges effort a little; it is an input, never a price. */
export const DEFAULT_CLASS_MULTIPLIER: Record<ExecutionClass, number> = {
  SIMPLE: 0.8, LIGHT: 0.9, STANDARD: 1, HEAVY: 1.1, COMPLEX: 1.2,
  // Escalations are usually Kimble's constraint (truncation, failover), so
  // they get only a modest uplift.
  ESCALATED: 1.1,
};

/** Default expected effort per class, used before history exists. */
export const DEFAULT_CLASS_EFFORT: Record<ExecutionClass, number> = {
  SIMPLE: 1, LIGHT: 2, STANDARD: 8, HEAVY: 14, COMPLEX: 24, ESCALATED: 30,
};

export type Curve = { a: number; p: number; floor: number; step: number };

/**
 * credits = a × effort^p. Calibrated from two anchors: a one-line edit
 * (effort ≈ 0.9) ≈ 0.35 credits and a complete 4-page website (effort ≈ 18)
 * ≈ 5 credits → p = ln(14.3)/ln(19.7) ≈ 0.9, a ≈ 0.38.
 */
export const DEFAULT_CURVE: Curve = { a: 0.38, p: 0.9, floor: 0.3, step: 0.01 };

export type EffortSignals = {
  cls: ExecutionClass;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  /** Changed lines per touched file. */
  linesPerFile: number[];
  pages: number;
  capabilities: number;
  validationsPassed: number;
  durationMs: number;
};

export type EffortBreakdown = { score: number; parts: Record<string, number> };

export function effortScore(s: EffortSignals, w: EffortWeights = DEFAULT_EFFORT_WEIGHTS, mult = DEFAULT_CLASS_MULTIPLIER): EffortBreakdown {
  const lines = s.linesPerFile.reduce((a, n) => a + Math.min(Math.max(0, n), w.lineCapPerFile), 0);
  const parts: Record<string, number> = {
    base: w.base,
    created: Math.max(0, s.filesCreated) * w.fileCreated,
    modified: Math.max(0, s.filesModified) * w.fileModified,
    deleted: Math.max(0, s.filesDeleted) * w.fileDeleted,
    lines: lines * w.perLine,
    pages: Math.max(0, s.pages) * w.page,
    capabilities: Math.max(0, s.capabilities) * w.capability,
    validation: Math.min(Math.max(0, s.validationsPassed), w.validationCap) * w.validation,
    time: Math.min(Math.max(0, s.durationMs) / 60000, w.minuteCap / Math.max(w.perMinute, 1e-9)) * w.perMinute,
  };
  const raw = Object.values(parts).reduce((a, b) => a + b, 0);
  const m = mult[s.cls] ?? 1;
  return { score: round2(raw * m), parts };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function roundUp(n: number, step: number) {
  const s = step > 0 ? step : 0.01;
  return Math.round(Math.ceil(n / s - 1e-9) * s * 100) / 100;
}

/** The floor applies to a calculated price; it is never a flat price. */
export function applyFloor(credits: number, c: Curve = DEFAULT_CURVE): number {
  return Math.max(roundUp(c.floor, c.step), roundUp(Math.max(0, credits), c.step));
}

export function creditsForEffort(score: number, c: Curve = DEFAULT_CURVE): number {
  return applyFloor(c.a * Math.pow(Math.max(0, score), c.p), c);
}

/** Pre-build estimate: history p75 once enough samples, else class default. */
export function estimateEffort(cls: ExecutionClass, history?: { samples: number; p75: number } | null, minSamples = 20, defaults = DEFAULT_CLASS_EFFORT): { effort: number; basis: "history" | "default" } {
  if (history && history.samples >= minSamples && history.p75 > 0) return { effort: history.p75, basis: "history" };
  return { effort: defaults[cls], basis: "default" };
}

export type Profitability = {
  revenueUsd: number; costUsd: number; productiveCostUsd: number; wastedCostUsd: number;
  contributionUsd: number; marginPct: number | null; costToRevenue: number | null; markup: number | null;
};

export function profitability(credits: number, revenuePerCreditUsd: number, costUsd: number, wastedCostUsd = 0): Profitability {
  const revenue = Math.max(0, credits) * revenuePerCreditUsd;
  const cost = Math.max(0, costUsd);
  const wasted = Math.min(cost, Math.max(0, wastedCostUsd));
  return {
    revenueUsd: revenue,
    costUsd: cost,
    productiveCostUsd: cost - wasted,
    wastedCostUsd: wasted,
    contributionUsd: revenue - cost,
    marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    costToRevenue: revenue > 0 ? cost / revenue : null,
    markup: cost > 0 ? revenue / cost : null,
  };
}

export type EconomicFlag = "underpriced" | "expensive_execution" | "bad_estimate";

/** Three separate problems, never merged. Flags only — never reprices. */
export function economicFlags(p: Profitability, est: { effort: number } | null, actualEffort: number, opts = { marginFloorPct: 70, wasteShare: 0.3, estimateError: 0.5 }): EconomicFlag[] {
  const f: EconomicFlag[] = [];
  const low = p.marginPct != null && p.marginPct < opts.marginFloorPct;
  const wasteful = p.costUsd > 0 && p.wastedCostUsd / p.costUsd >= opts.wasteShare;
  if (low && wasteful) f.push("expensive_execution");
  else if (low) f.push("underpriced");
  if (est && est.effort > 0 && Math.abs(actualEffort - est.effort) / est.effort > opts.estimateError) f.push("bad_estimate");
  return f;
}

/** Overlay `effort_*` economics_config keys onto the defaults. */
export function effortConfig(v: Record<string, number>): { weights: EffortWeights; curve: Curve; classEffort: Record<ExecutionClass, number>; marginFloorPct: number; estimateError: number } {
  const weights = { ...DEFAULT_EFFORT_WEIGHTS };
  for (const k of Object.keys(weights) as (keyof EffortWeights)[]) {
    const n = v[`effort_w_${k}`];
    if (Number.isFinite(n)) weights[k] = n;
  }
  const classEffort = { ...DEFAULT_CLASS_EFFORT };
  for (const k of Object.keys(classEffort) as ExecutionClass[]) {
    const n = v[`effort_class_${k.toLowerCase()}`];
    if (Number.isFinite(n)) classEffort[k] = n;
  }
  const num = (k: string, d: number) => (Number.isFinite(v[k]) ? v[k] : d);
  return {
    weights,
    classEffort,
    curve: { a: num("effort_curve_a", DEFAULT_CURVE.a), p: num("effort_curve_p", DEFAULT_CURVE.p), floor: num("min_charge_credits", DEFAULT_CURVE.floor), step: num("credit_rounding_step", DEFAULT_CURVE.step) },
    marginFloorPct: num("effort_margin_floor_pct", 70),
    estimateError: num("effort_estimate_error", 0.5),
  };
}

/** Measure file-level signals from a before/after tree. */
export function diffSignals(before: Record<string, string>, after: Record<string, string>, isPage: (p: string) => boolean): Pick<EffortSignals, "filesCreated" | "filesModified" | "filesDeleted" | "linesPerFile" | "pages"> {
  let c = 0, m = 0, d = 0, pages = 0;
  const lines: number[] = [];
  for (const [p, txt] of Object.entries(after)) {
    const prev = before[p];
    if (prev === undefined) { c++; lines.push(txt.split("\n").length); if (isPage(p)) pages++; }
    else if (prev !== txt) { m++; lines.push(changedLines(prev, txt)); if (isPage(p)) pages++; }
  }
  for (const p of Object.keys(before)) if (!(p in after)) d++;
  return { filesCreated: c, filesModified: m, filesDeleted: d, linesPerFile: lines, pages };
}

function changedLines(a: string, b: string): number {
  const A = a.split("\n"), B = b.split("\n");
  const count = new Map<string, number>();
  for (const l of A) count.set(l, (count.get(l) ?? 0) + 1);
  let common = 0;
  for (const l of B) { const n = count.get(l) ?? 0; if (n > 0) { common++; count.set(l, n - 1); } }
  return Math.max(A.length, B.length) - common;
}

export const PAGE_PATH = /^src\/(pages|routes)\/(?!__root|api\/).+\.[jt]sx$/;

/** Measurable waste: provider retries, repairs and failed calls. Kimble's cost, never billed. */
export function wastedCostUsd(rows: { call_kind: string | null; status: number | null; cost_usd_micro: number | null; stage: string | null }[]): number {
  let w = 0;
  for (const r of rows) {
    if (r.stage === "after" || r.cost_usd_micro == null) continue;
    if (r.call_kind === "retry" || r.call_kind === "repair" || (r.status != null && r.status >= 400)) w += Number(r.cost_usd_micro) / 1e6;
  }
  return w;
}
