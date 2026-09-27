/**
 * The single append-only cost ledger (`cost_events`).
 *
 * Rules: provider-reported cost is ACTUAL; rate-derived cost is ESTIMATED;
 * shared costs are ALLOCATED; anything else is UNKNOWN with a NULL amount —
 * never a fake $0. Rows are keyed by `source_ref`, so re-running a sync is
 * idempotent. Refunds never delete rows.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CostCategory =
  | "AI_INFERENCE" | "AI_VERIFICATION" | "AI_REASONING" | "IMAGE_GENERATION"
  | "BUILD_COMPUTE" | "BROWSER_COMPUTE" | "DEPLOYMENT" | "STORAGE" | "DATABASE"
  | "NETWORK" | "OTHER_VARIABLE" | "FAILED_WORK";
export type CostBasisTag = "ACTUAL" | "ESTIMATED" | "ALLOCATED" | "UNKNOWN";

export type CostEvent = {
  sourceRef: string;
  userId?: string | null;
  projectId?: string | null;
  turnId?: string | null;
  revision?: number | null;
  buildId?: string | null;
  stage?: string | null;
  category: CostCategory;
  provider?: string | null;
  resource?: string | null;
  quantity?: number | null;
  unit?: string | null;
  costUsd: number | null;
  basis: CostBasisTag;
  failedWork?: boolean;
  metadata?: Record<string, unknown>;
};

/** Normalise so UNKNOWN always carries NULL and a NULL amount is UNKNOWN. */
export function normaliseCost(e: Pick<CostEvent, "costUsd" | "basis">): { costUsd: number | null; basis: CostBasisTag } {
  if (e.costUsd == null || !Number.isFinite(e.costUsd)) return { costUsd: null, basis: "UNKNOWN" };
  if (e.basis === "UNKNOWN") return { costUsd: null, basis: "UNKNOWN" };
  return { costUsd: e.costUsd, basis: e.basis };
}

export function toRow(e: CostEvent) {
  const n = normaliseCost(e);
  return {
    source_ref: e.sourceRef,
    user_id: e.userId ?? null,
    project_id: e.projectId ?? null,
    turn_id: e.turnId ?? null,
    revision: e.revision ?? null,
    build_id: e.buildId ?? null,
    stage: e.stage ?? null,
    category: e.category,
    provider: e.provider ?? null,
    resource: e.resource ?? null,
    quantity: e.quantity ?? null,
    unit: e.unit ?? null,
    cost_usd: n.costUsd,
    cost_basis: n.basis,
    failed_work: e.failedWork ?? false,
    metadata: e.metadata ?? {},
  };
}

export async function recordCostEvents(events: CostEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    const { error } = await supabaseAdmin
      .from("cost_events" as never)
      .upsert(events.map(toRow) as never, { onConflict: "source_ref", ignoreDuplicates: true });
    // supabase-js returns errors instead of throwing: never lose them silently.
    if (error) console.warn("[cost-events] write failed", error.message);
  } catch (err) {
    console.warn("[cost-events] write failed", err);
  }
}

type AiRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  turn_id: string | null;
  stage: string | null;
  model: string | null;
  upstream_provider: string | null;
  provider: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd_micro: number | null;
  cost_basis: string | null;
  status: number | null;
  build_id?: string | null;
  revision?: number | null;
};

/** Map one ai_call_log row to its cost event (ACTUAL when OpenRouter reported). */
export function aiRowToCostEvent(r: AiRow): CostEvent {
  const cost = r.cost_usd_micro == null ? null : Number(r.cost_usd_micro) / 1_000_000;
  const basis: CostBasisTag = cost == null ? "UNKNOWN" : r.cost_basis === "actual" ? "ACTUAL" : "ESTIMATED";
  return {
    sourceRef: `ai:${r.id}`,
    userId: r.user_id,
    projectId: r.project_id,
    turnId: r.turn_id,
    buildId: r.build_id ?? null,
    revision: r.revision ?? null,
    stage: r.stage,
    category: r.stage === "verify" ? "AI_VERIFICATION" : "AI_INFERENCE",
    provider: r.upstream_provider ?? r.provider,
    resource: r.model,
    quantity: Number(r.prompt_tokens ?? 0) + Number(r.completion_tokens ?? 0),
    unit: "tokens",
    costUsd: cost,
    basis,
    failedWork: r.status != null && r.status >= 400,
  };
}

/**
 * Classify each call within a turn: a second call with the same stage+purpose
 * signature before any write is REDUNDANT; provider resends are RETRY;
 * repairs are RECOVERY; browser checks are VERIFICATION.
 */
export function classifyTurnCalls(
  rows: Array<{ stage: string | null; purpose: string | null; call_kind: string | null }>,
): Array<"REQUIRED" | "REDUNDANT" | "RETRY" | "RECOVERY" | "VERIFICATION" | "MEMORY" | "OTHER"> {
  const seen = new Set<string>();
  return rows.map((r) => {
    if (r.call_kind === "retry") return "RETRY";
    if (r.call_kind === "repair") return "RECOVERY";
    if (r.stage === "verify") return "VERIFICATION";
    if (r.stage === "after") return "MEMORY";
    if (r.stage === "write" && /one requested page/.test(r.purpose ?? "")) return "REQUIRED";
    const key = `${r.stage}|${r.purpose}`;
    if (r.stage === "request" && seen.has(key)) return "REDUNDANT";
    seen.add(key);
    return r.stage ? "REQUIRED" : "OTHER";
  });
}
