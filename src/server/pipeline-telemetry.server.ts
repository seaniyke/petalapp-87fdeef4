/**
 * Phase 6 — pipeline tier telemetry.
 *
 * One row per tier per build turn, written to `public.pipeline_tier_events`.
 * Powers the /admin/pipeline dashboard (tier outcome rates, p50/p95
 * latency, top hallucinated packages, handoff frequency).
 *
 * Design rules (mirrors `ai-outcomes.server.ts`):
 *   - Fire-and-forget. NEVER throws back into the orchestrator. NEVER blocks
 *     the SSE stream. A telemetry write failure must not affect a build.
 *   - One round-trip per turn. We accumulate rows in a `TurnRecorder` and
 *     flush them all in a single insert when the orchestrator finishes the
 *     turn (success OR failure path).
 *   - No PII. Only IDs and structural metadata go into `details`.
 *
 * Why not write per-tier inline: each tier finishes in <100ms; doing 7
 * round-trips to Postgres would add noticeable latency. Batched insert at
 * end-of-turn is invisible.
 */

export type TierName =
  | "file_budget"
  | "stream_autofix"
  | "local_verify"
  | "hallu_strip"
  | "continuation"
  | "esbuild"
  | "render_risk"
  | "rls_sanity"
  | "post_stream_autofix";

export type TierOutcome = "ok" | "failed" | "fixed" | "warned" | "skipped";

/** Canonical pipeline order — keeps dashboards from having to re-sort. */
const TIER_ORDER: Record<TierName, number> = {
  file_budget: 2.4,
  stream_autofix: 2.45,
  local_verify: 2.5,
  hallu_strip: 2.46,
  continuation: 2.6,
  esbuild: 2.7,
  render_risk: 2.8,
  rls_sanity: 2.9,
  post_stream_autofix: 3,
};

interface TierRow {
  tier: TierName;
  outcome: TierOutcome;
  duration_ms: number;
  issue_count: number;
  details: Record<string, unknown>;
}

export interface TurnContext {
  turnId: string;
  projectId: string | null;
  messageId: string | null;
  model: string | null;
}

export class TurnRecorder {
  private rows: TierRow[] = [];
  private flushed = false;

  constructor(private ctx: TurnContext) {}

  /** Record a single tier outcome. */
  record(row: TierRow): void {
    if (this.flushed) return; // late writes are dropped — turn already shipped
    this.rows.push(row);
  }

  /** Time a sync or async tier and record its outcome.
   *  The classifier turns the tier output into an `(outcome, count, details)`
   *  triple so each call site can express tier-specific semantics. */
  async time<T>(
    tier: TierName,
    fn: () => Promise<T> | T,
    classify: (result: T) => {
      outcome: TierOutcome;
      issueCount?: number;
      details?: Record<string, unknown>;
    },
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const c = classify(result);
      this.record({
        tier,
        outcome: c.outcome,
        duration_ms: Date.now() - start,
        issue_count: c.issueCount ?? 0,
        details: c.details ?? {},
      });
      return result;
    } catch (err) {
      this.record({
        tier,
        outcome: "failed",
        duration_ms: Date.now() - start,
        issue_count: 0,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  /** Flush all accumulated rows in a single insert. Idempotent — safe to
   *  call multiple times (e.g. from both the success and the catch path). */
  async flush(): Promise<void> {
    if (this.flushed) return;
    this.flushed = true;
    if (this.rows.length === 0) return;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const payload = this.rows.map((r) => ({
        turn_id: this.ctx.turnId,
        project_id: this.ctx.projectId,
        message_id: this.ctx.messageId,
        model: this.ctx.model,
        tier: r.tier,
        tier_order: TIER_ORDER[r.tier],
        outcome: r.outcome,
        duration_ms: r.duration_ms,
        issue_count: r.issue_count,
        // The generated `Json` type from supabase doesn't accept arbitrary
        // Record<string, unknown> — cast through unknown since the Postgres
        // jsonb column accepts any structurally-valid JSON value.
        details: r.details as unknown as Record<string, never>,
      }));
      const { error } = await supabaseAdmin.from("pipeline_tier_events").insert(payload);
      if (error) console.warn("[pipeline-telemetry] insert failed", error.message);
    } catch (err) {
      console.warn("[pipeline-telemetry] flush threw", err);
    }
  }

  /** Allow the orchestrator to update the model field after smart-router
   *  picks one (we create the recorder before that decision). */
  setModel(model: string | null): void {
    this.ctx.model = model;
  }
}
