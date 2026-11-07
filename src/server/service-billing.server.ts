/**
 * What Petal bills Custard AI, read straight from the ONE credit ledger.
 *
 * Custard AI sees exactly what Petal charged its service account, in
 * credits: per turn (build charge, refunds, usage counts) and per project /
 * account over a date range. Petal's own provider costs and margin are never
 * returned — only the bill.
 */

export type LedgerRow = {
  delta: number | string;
  reason: string;
  created_at?: string;
  turn_id?: string | null;
  project_id?: string | null;
  metadata?: unknown;
};

export type BillCategory = "build" | "cloud" | "ai" | "other";

export type BillSummary = {
  currency: "credits";
  charged: number;
  refunded: number;
  net: number;
  byCategory: Record<BillCategory, number>;
};

const BUILD = new Set(["ai_build_charge", "ai_build_hold", "ai_build_topup"]);
const CLOUD = new Set(["runtime_charge", "runtime_fallback"]);
const AI = new Set([
  "ai_message",
  "ai_image",
  "ai_image_charge",
  "ai_discuss",
  "ai_discuss_charge",
  "ai_coach_charge",
  "ai_transcribe_charge",
]);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Refund rows return credits; a refund reversal takes them back. */
export function isRefund(reason: string): boolean {
  return /refund/.test(reason);
}

export function categoryOf(reason: string): BillCategory {
  if (BUILD.has(reason)) return "build";
  if (CLOUD.has(reason)) return "cloud";
  if (AI.has(reason)) return "ai";
  return "other";
}

/**
 * Charges are negative non-refund rows; refunds are refund-reason rows (a
 * reversal is a negative refund). Credits added (top-ups, grants) are funding,
 * not part of the bill, and are ignored here.
 */
export function summarizeLedger(rows: LedgerRow[]): BillSummary {
  const byCategory: Record<BillCategory, number> = { build: 0, cloud: 0, ai: 0, other: 0 };
  let charged = 0;
  let refunded = 0;
  for (const row of rows) {
    const delta = Number(row.delta);
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (isRefund(row.reason)) {
      refunded += delta;
      continue;
    }
    if (delta > 0) continue;
    charged += -delta;
    byCategory[categoryOf(row.reason)] += -delta;
  }
  return {
    currency: "credits",
    charged: r2(charged),
    refunded: r2(refunded),
    net: r2(charged - refunded),
    byCategory: {
      build: r2(byCategory.build),
      cloud: r2(byCategory.cloud),
      ai: r2(byCategory.ai),
      other: r2(byCategory.other),
    },
  };
}

/** Credits added to the account (top-ups, grants) in the rows. */
export function sumFunding(rows: LedgerRow[]): number {
  let added = 0;
  for (const row of rows) {
    const delta = Number(row.delta);
    if (delta > 0 && !isRefund(row.reason)) added += delta;
  }
  return r2(added);
}

export type TurnUsage = {
  aiCalls: number;
  promptTokens: number;
  completionTokens: number;
  imagesGenerated: number;
  models: string[];
};

export type TurnBill = BillSummary & {
  turnId: string;
  projectId: string | null;
  settlement: string | null;
  reserved: number | null;
  estimated: number | null;
  usage: TurnUsage | null;
};

type EconomicsRow = {
  project_id: string | null;
  settlement_state: string | null;
  credits_reserved: number | string | null;
  credits_estimated: number | string | null;
  ai_calls: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  images_generated: number | null;
  models: unknown;
};

function modelNames(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((m): m is string => typeof m === "string");
  if (raw && typeof raw === "object") return Object.keys(raw as Record<string, unknown>);
  return [];
}

export function buildTurnBill(turnId: string, rows: LedgerRow[], econ: EconomicsRow | null): TurnBill {
  const num = (v: number | string | null | undefined) => (v == null ? null : r2(Number(v)));
  return {
    turnId,
    projectId: econ?.project_id ?? rows.find((r) => r.project_id)?.project_id ?? null,
    ...summarizeLedger(rows),
    settlement: econ?.settlement_state ?? null,
    reserved: num(econ?.credits_reserved),
    estimated: num(econ?.credits_estimated),
    usage: econ
      ? {
          aiCalls: Number(econ.ai_calls ?? 0),
          promptTokens: Number(econ.prompt_tokens ?? 0),
          completionTokens: Number(econ.completion_tokens ?? 0),
          imagesGenerated: Number(econ.images_generated ?? 0),
          models: modelNames(econ.models),
        }
      : null,
  };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const LEDGER_COLUMNS = "delta, reason, created_at, turn_id, project_id, metadata";
const MAX_ROWS = 5000;

/** The bill for one turn of the service account. */
export async function turnBill(ownerId: string, turnId: string): Promise<TurnBill> {
  const sb = await admin();
  const [{ data: rows }, { data: econ }] = await Promise.all([
    sb.from("credit_ledger").select(LEDGER_COLUMNS).eq("user_id", ownerId).eq("turn_id", turnId).limit(500),
    sb
      .from("turn_economics")
      .select("project_id, settlement_state, credits_reserved, credits_estimated, ai_calls, prompt_tokens, completion_tokens, images_generated, models")
      .eq("turn_id", turnId)
      .eq("user_id", ownerId)
      .maybeSingle(),
  ]);
  return buildTurnBill(turnId, (rows ?? []) as LedgerRow[], (econ as EconomicsRow | null) ?? null);
}

export type Range = { from: string; to: string };

export function defaultRange(now = new Date()): Range {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

async function ledgerRows(ownerId: string, range: Range, projectId?: string) {
  const sb = await admin();
  let q = sb
    .from("credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("user_id", ownerId)
    .gte("created_at", range.from)
    .lt("created_at", range.to);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q.order("created_at", { ascending: false }).limit(MAX_ROWS + 1);
  const rows = (data ?? []) as LedgerRow[];
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

/** Per-turn bills grouped from ledger rows, newest first. */
export function groupByTurn(rows: LedgerRow[], limit: number) {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    if (!row.turn_id) continue;
    const list = groups.get(row.turn_id) ?? [];
    list.push(row);
    groups.set(row.turn_id, list);
  }
  return [...groups.entries()].slice(0, limit).map(([turnId, list]) => ({
    turnId,
    at: list[list.length - 1]?.created_at ?? null,
    ...summarizeLedger(list),
  }));
}

export async function projectBilling(ownerId: string, projectId: string, range: Range, limit = 50) {
  const { rows, truncated } = await ledgerRows(ownerId, range, projectId);
  return {
    projectId,
    range,
    summary: summarizeLedger(rows),
    turns: groupByTurn(rows, limit),
    truncated,
  };
}

export async function accountBilling(ownerId: string, range: Range) {
  const sb = await admin();
  const [{ rows, truncated }, { data: balance }] = await Promise.all([
    ledgerRows(ownerId, range),
    sb.rpc("available_credits", { _user_id: ownerId }),
  ]);
  const perProject = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const key = row.project_id ?? "unassigned";
    const list = perProject.get(key) ?? [];
    list.push(row);
    perProject.set(key, list);
  }
  const projects = [...perProject.entries()]
    .map(([projectId, list]) => ({ projectId: projectId === "unassigned" ? null : projectId, ...summarizeLedger(list) }))
    .filter((p) => p.charged > 0 || p.refunded !== 0)
    .sort((a, b) => b.net - a.net);
  return {
    range,
    balance: balance == null ? null : r2(Number(balance)),
    added: sumFunding(rows),
    summary: summarizeLedger(rows),
    projects,
    truncated,
  };
}
