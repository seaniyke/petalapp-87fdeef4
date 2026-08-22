/**
 * Petal Intelligence — Phase F: per-agent observability.
 *
 * Every board sitting writes one row per specialist into `agent_runs`, so we
 * can answer the questions that decide whether this layer earns its keep:
 * which agents actually fire, how long they take, how often they degrade, and
 * what they cost. Read by /admin/pipeline.
 *
 * Fire-and-forget by contract: this never throws and never blocks a build.
 */

import type { OrchestrationTelemetry } from "./orchestrator.server";

export interface RecordAgentRunsArgs {
  telemetry: OrchestrationTelemetry;
  projectId: string | null;
  userId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null): string | null => (v && UUID.test(v) ? v : null);

export async function recordAgentRuns(args: RecordAgentRunsArgs): Promise<void> {
  const { telemetry } = args;
  if (!telemetry.runs.length) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = telemetry.runs.map((run) => ({
      turn_id: telemetry.turnId,
      project_id: asUuid(args.projectId),
      user_id: asUuid(args.userId),
      profile: telemetry.profile,
      complexity: Math.round(telemetry.complexity),
      agent: run.agent,
      status: run.status,
      attempts: run.attempts,
      ms: Math.round(run.ms),
      cost_micro_usd: Math.round(run.costMicroUsd),
      decisions: run.decisions,
      objections: run.objections,
      optional: run.optional,
      error: run.error ? String(run.error).slice(0, 500) : null,
    }));
    const { error } = await supabaseAdmin.from("agent_runs").insert(rows as never);
    if (error) console.warn("[agent-telemetry] insert failed:", error.message);
  } catch (e) {
    console.warn("[agent-telemetry] skipped:", e instanceof Error ? e.message : String(e));
  }
}
