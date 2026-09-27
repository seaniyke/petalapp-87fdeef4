/**
 * Build credit reservation: estimate → reserve before work, release on end.
 * Runs identically in the Worker and on the build server (the admin client is
 * shimmed through the scoped gateway there). Pricing math lives only in
 * `@/lib/build-pricing`.
 */
import { classCostUsd, estimateCredits, type BuildEconomics } from "@/lib/build-pricing";
import type { ExecutionClass } from "@/server/execution/complexity";

export type Reservation = {
  ok: boolean;
  estimated: number;
  reserved: number;
  /** Estimated effort score behind `estimated` (effort pricing). */
  estimatedEffort?: number;
  available: number;
  estimateBasis: "measured_p90" | "default";
  classCostUsd: number;
  error?: string;
};

const DEFAULT_KEY: Record<ExecutionClass, string> = {
  SIMPLE: "estimate_cost_simple_usd",
  LIGHT: "estimate_cost_light_usd",
  STANDARD: "estimate_cost_standard_usd",
  HEAVY: "estimate_cost_heavy_usd",
  COMPLEX: "estimate_cost_complex_usd",
  ESCALATED: "estimate_cost_escalated_usd",
};

export async function estimateForClass(cls: ExecutionClass): Promise<{ usd: number; basis: "measured_p90" | "default"; economics: BuildEconomics }> {
  const { economicsValues, buildEconomics } = await import("@/server/economics-config.server");
  const [v, economics] = await Promise.all([economicsValues(), buildEconomics()]);
  let p90: number | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("billing_class_cost_p90" as never, {
      _class: cls,
      _min_samples: Math.max(1, Math.round(v.estimate_min_samples)),
    } as never);
    p90 = data == null ? null : Number(data);
  } catch { /* defaults below */ }
  const pick = classCostUsd(p90, (v as Record<string, number>)[DEFAULT_KEY[cls]] ?? 0.03);
  return { ...pick, economics };
}

/** Pre-build effort estimate → estimated customer credits (effort curve). */
export async function estimateEffortCredits(cls: ExecutionClass): Promise<{ effort: number; credits: number; basis: "history" | "default" }> {
  const ep = await import("@/lib/effort-pricing");
  const { economicsValues } = await import("@/server/economics-config.server");
  const v = (await economicsValues()) as Record<string, number>;
  const cfg = ep.effortConfig(v);
  let history: { samples: number; p75: number } | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("billing_class_effort_p75" as never, { _class: cls } as never);
    const row = (Array.isArray(data) ? data[0] : data) as { samples?: number; p75?: number } | null;
    if (row) history = { samples: Number(row.samples ?? 0), p75: Number(row.p75 ?? 0) };
  } catch { /* defaults */ }
  const e = ep.estimateEffort(cls, history, Math.max(1, Math.round(v.estimate_min_samples ?? 20)), cfg.classEffort);
  return { effort: e.effort, credits: ep.creditsForEffort(e.effort, cfg.curve), basis: e.basis };
}

/** Reserve credits for one build turn. Never throws. */
export async function reserveBuildCredits(args: { userId: string; turnId: string; cls: ExecutionClass }): Promise<Reservation> {
  const est = await estimateForClass(args.cls);
  let estimated = estimateCredits(est.usd, est.economics);
  let estimatedEffort: number | undefined;
  try {
    const eff = await estimateEffortCredits(args.cls);
    estimated = eff.credits;
    estimatedEffort = eff.effort;
  } catch { /* fall back to cost estimate */ }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("reserve_build_credits" as never, {
      _user_id: args.userId,
      _turn_id: args.turnId,
      _estimate: estimated,
      _headroom: est.economics.reservationHeadroom,
      _class: args.cls,
      _estimate_basis: est.basis,
    } as never);
    if (error) throw new Error((error as { message: string }).message);
    const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reserved?: number; available?: number } | null;
    return {
      ok: !!row?.ok,
      estimated,
      estimatedEffort,
      reserved: Number(row?.reserved ?? 0),
      available: Number(row?.available ?? 0),
      estimateBasis: est.basis,
      classCostUsd: est.usd,
    };
  } catch (e) {
    return { ok: false, estimated, estimatedEffort, reserved: 0, available: 0, estimateBasis: est.basis, classCostUsd: est.usd, error: (e as Error).message };
  }
}

/** Release a held reservation (idempotent; also done by the turn-end trigger). */
export async function releaseBuildReservation(turnId: string, reason: string): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("release_build_reservation" as never, { _turn_id: turnId, _reason: reason } as never);
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}
