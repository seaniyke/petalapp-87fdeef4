/**
 * Petal Intelligence — orchestrator entry point.
 *
 * One call, one turn. The generation pipeline hands in the prompt plus the
 * contracts it already has (PRD, design direction); the orchestrator selects
 * a profile, convenes the right specialists, reconciles their conflicts, and
 * returns a prompt block plus telemetry.
 *
 * Contract with the rest of Petal:
 *  - Additive. It never mutates project files and never throws into the
 *    caller. Any internal failure degrades to `{ ok: false, block: "" }` and
 *    the existing pipeline runs exactly as before.
 *  - Flag-gated (`PETAL_ORCHESTRATOR`, default on) so it can be turned off in
 *    one place if a turn ever regresses.
 */

import {
  createTurnContext,
  renderDecisionBlock,
  type AgentName,
  type CreateContextArgs,
  type Decision,
  type ExecutionProfile,
  type Objection,
  type OrchestratorLogEntry,
  type TurnContext,
} from "./context";
import { executeAgents, reconcile } from "./runtime";
import { selectAgents } from "./selection";

export interface OrchestrationTelemetry {
  turnId: string;
  profile: ExecutionProfile;
  complexity: number;
  reason: string;
  agents: AgentName[];
  runs: TurnContext["runs"];
  decisionCount: number;
  objectionCount: number;
  blockingObjections: number;
  costMicroUsd: number;
  ms: number;
  log: OrchestratorLogEntry[];
}

export interface OrchestrationResult {
  ok: boolean;
  /** Prompt block to append to the generation system prompt. Empty when skipped. */
  block: string;
  decisions: Decision[];
  objections: Objection[];
  telemetry: OrchestrationTelemetry;
  /** The full board, for callers that want structured access. */
  context: TurnContext;
}

function orchestratorEnabled(): boolean {
  const raw = process.env["PETAL_ORCHESTRATOR"];
  if (raw == null || raw === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

function emptyTelemetry(ctx: TurnContext, started: number): OrchestrationTelemetry {
  return {
    turnId: ctx.turnId,
    profile: ctx.profile,
    complexity: 0,
    reason: "orchestrator disabled",
    agents: [],
    runs: [],
    decisionCount: 0,
    objectionCount: 0,
    blockingObjections: 0,
    costMicroUsd: 0,
    ms: Date.now() - started,
    log: ctx.log,
  };
}

export async function orchestrateTurn(
  args: CreateContextArgs,
): Promise<OrchestrationResult> {
  const started = Date.now();
  const ctx = createTurnContext(args);

  if (!orchestratorEnabled()) {
    return {
      ok: false,
      block: "",
      decisions: [],
      objections: [],
      telemetry: emptyTelemetry(ctx, started),
      context: ctx,
    };
  }

  try {
    const selection = selectAgents(ctx);
    ctx.profile = selection.profile;
    ctx.log.push({
      at: Date.now(),
      event: "profile_selected",
      detail: `${selection.profile} (complexity ${selection.complexity}) — ${selection.reason}`,
      data: { profile: selection.profile, complexity: selection.complexity },
    });
    ctx.log.push({
      at: Date.now(),
      event: "agents_selected",
      detail: selection.agents.join(", ") || "none",
      data: { agents: selection.agents },
    });

    if (selection.agents.length === 0) {
      ctx.log.push({ at: Date.now(), event: "done", detail: "no agents for this turn" });
      return {
        ok: true,
        block: "",
        decisions: [],
        objections: [],
        telemetry: {
          turnId: ctx.turnId,
          profile: ctx.profile,
          complexity: selection.complexity,
          reason: selection.reason,
          agents: [],
          runs: [],
          decisionCount: 0,
          objectionCount: 0,
          blockingObjections: 0,
          costMicroUsd: 0,
          ms: Date.now() - started,
          log: ctx.log,
        },
        context: ctx,
      };
    }

    const result = await executeAgents(ctx, selection.agents);
    reconcile(ctx);

    const block = result.ok || ctx.decisions.length > 0 ? renderDecisionBlock(ctx) : "";
    ctx.log.push({
      at: Date.now(),
      event: "done",
      detail: `${ctx.decisions.length} decisions, ${ctx.objections.length} objections, ${
        Date.now() - started
      }ms`,
    });

    return {
      ok: result.ok,
      block,
      decisions: ctx.decisions,
      objections: ctx.objections,
      telemetry: {
        turnId: ctx.turnId,
        profile: ctx.profile,
        complexity: selection.complexity,
        reason: selection.reason,
        agents: selection.agents,
        runs: ctx.runs,
        decisionCount: ctx.decisions.length,
        objectionCount: ctx.objections.length,
        blockingObjections: ctx.objections.filter((o) => o.severity === "blocking").length,
        costMicroUsd: ctx.budget.spentMicroUsd,
        ms: Date.now() - started,
        log: ctx.log,
      },
      context: ctx,
    };
  } catch (error) {
    // Never let planning break a build.
    const message = error instanceof Error ? error.message : String(error);
    ctx.log.push({ at: Date.now(), event: "done", detail: `orchestrator error: ${message}` });
    return {
      ok: false,
      block: "",
      decisions: ctx.decisions,
      objections: ctx.objections,
      telemetry: { ...emptyTelemetry(ctx, started), reason: `error: ${message.slice(0, 200)}` },
      context: ctx,
    };
  }
}

/** Compact one-line summary for server logs. */
export function summarizeOrchestration(t: OrchestrationTelemetry): string {
  const failed = t.runs.filter((r) => r.status === "failed").map((r) => r.agent);
  return [
    `[orchestrator] ${t.profile}/c${t.complexity}`,
    `${t.agents.length} agents`,
    `${t.decisionCount} decisions`,
    t.blockingObjections ? `${t.blockingObjections} blocking` : "",
    failed.length ? `failed: ${failed.join(",")}` : "",
    `${t.ms}ms`,
  ]
    .filter(Boolean)
    .join(" · ");
}
