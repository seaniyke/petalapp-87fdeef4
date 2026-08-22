/**
 * Petal Intelligence — agent execution lifecycle.
 *
 * Runs the selected agents wave by wave: parallel inside a wave, sequential
 * across waves. Owns retries, timeouts, budget, graceful degradation and the
 * decision log. It knows nothing about any specific agent — only the registry
 * contract — so a new specialist never touches this file.
 *
 * Hard rule, same as every other Petal layer: a failing OPTIONAL agent can
 * never fail a build. It is recorded, skipped, and the turn continues.
 */

import {
  agentView,
  nextDecisionId,
  type AgentName,
  type AgentOutput,
  type AgentRun,
  type OrchestratorLogEntry,
  type TurnContext,
} from "./context";
import { AGENT_REGISTRY } from "./registry";
import { planWaves } from "./selection";

function log(ctx: TurnContext, entry: Omit<OrchestratorLogEntry, "at">): void {
  ctx.log.push({ at: Date.now(), ...entry });
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Merge an agent's output onto the board, minting ids and wiring provenance. */
function applyOutput(ctx: TurnContext, agent: AgentName, out: AgentOutput): {
  decisions: number;
  objections: number;
} {
  let decisions = 0;
  let objections = 0;

  for (const d of out.decisions ?? []) {
    ctx.decisions.push({ id: nextDecisionId(agent), agent, ...d });
    decisions += 1;
  }
  for (const o of out.objections ?? []) {
    ctx.objections.push({ id: nextDecisionId(agent), agent, ...o });
    objections += 1;
  }
  if (out.prd) ctx.prd = out.prd;
  if (out.design) ctx.design = out.design;
  ctx.budget.spentMicroUsd += Math.max(0, out.usage?.costMicroUsd ?? 0);

  return { decisions, objections };
}

async function runOne(ctx: TurnContext, name: AgentName): Promise<AgentRun> {
  const spec = AGENT_REGISTRY[name];
  const started = Date.now();
  const run: AgentRun = {
    agent: name,
    status: "running",
    attempts: 0,
    ms: 0,
    costMicroUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    decisions: 0,
    objections: 0,
    optional: spec.optional,
  };

  let lastError = "";
  while (run.attempts < spec.maxAttempts) {
    run.attempts += 1;
    log(ctx, {
      event: run.attempts === 1 ? "agent_start" : "agent_retry",
      detail: `${name} attempt ${run.attempts}`,
    });
    try {
      const out = await withTimeout(
        Promise.resolve(spec.run(agentView(ctx))),
        spec.timeoutMs,
        name,
      );
      const applied = applyOutput(ctx, name, out);
      run.decisions = applied.decisions;
      run.objections = applied.objections;
      run.costMicroUsd = Math.max(0, out.usage?.costMicroUsd ?? 0);
      run.tokensIn = Math.max(0, out.usage?.tokensIn ?? 0);
      run.tokensOut = Math.max(0, out.usage?.tokensOut ?? 0);
      run.status = applied.decisions === 0 && applied.objections === 0 ? "degraded" : "ok";
      run.ms = Date.now() - started;
      log(ctx, {
        event: "agent_end",
        detail: `${name} ${run.status} (${run.decisions} decisions, ${run.ms}ms)`,
        data: { agent: name, status: run.status },
      });
      return run;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  run.status = "failed";
  run.error = lastError.slice(0, 300);
  run.ms = Date.now() - started;
  log(ctx, {
    event: "agent_end",
    detail: `${name} failed after ${run.attempts} attempt(s): ${run.error}`,
    data: { agent: name, status: "failed" },
  });
  return run;
}

export interface ExecuteResult {
  /** True when every required agent completed. */
  ok: boolean;
  /** Required agents that failed — the only thing that can stop planning. */
  failedRequired: AgentName[];
}

export async function executeAgents(
  ctx: TurnContext,
  agents: AgentName[],
): Promise<ExecuteResult> {
  const waves = planWaves(agents);
  const failedRequired: AgentName[] = [];

  for (const wave of waves) {
    if (Date.now() > ctx.budget.deadlineAt) {
      log(ctx, {
        event: "budget_exhausted",
        detail: `Planning deadline reached — skipping ${wave.join(", ")}`,
      });
      for (const name of wave) {
        ctx.runs.push({
          agent: name,
          status: "skipped",
          attempts: 0,
          ms: 0,
          costMicroUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          decisions: 0,
          objections: 0,
          optional: AGENT_REGISTRY[name].optional,
        });
      }
      continue;
    }

    log(ctx, { event: "batch_start", detail: `wave: ${wave.join(", ")}` });

    const results = await Promise.all(
      wave.map(async (name) => {
        const spec = AGENT_REGISTRY[name];
        const overBudget =
          spec.budgetMicroUsd > 0 &&
          ctx.budget.spentMicroUsd + spec.budgetMicroUsd > ctx.budget.ceilingMicroUsd;
        if (overBudget && spec.optional) {
          log(ctx, { event: "agent_skipped", detail: `${name} skipped — planning budget` });
          return {
            agent: name,
            status: "skipped",
            attempts: 0,
            ms: 0,
            costMicroUsd: 0,
            tokensIn: 0,
            tokensOut: 0,
            decisions: 0,
            objections: 0,
            optional: true,
          } satisfies AgentRun;
        }
        return runOne(ctx, name);
      }),
    );

    for (const r of results) {
      ctx.runs.push(r);
      if (r.status === "failed" && !r.optional) failedRequired.push(r.agent);
    }

    // A required agent failing means downstream planning would be built on
    // sand. Stop the board; the caller falls back to the existing pipeline.
    if (failedRequired.length > 0) break;
  }

  return { ok: failedRequired.length === 0, failedRequired };
}

/**
 * Reconciliation. Agents may contradict each other; precedence decides, and
 * the precedence order is fixed and explicit rather than emergent:
 *
 *   product intent > security > architecture > data > ux > design > copy
 *
 * Phase 1 resolves the only conflict class that exists today (blocking
 * objections) by promoting each one to a binding decision owned by the
 * objecting agent, so the generation prompt carries it as a requirement.
 */
export function reconcile(ctx: TurnContext): void {
  const blocking = ctx.objections.filter((o) => o.severity === "blocking");
  for (const o of blocking) {
    ctx.decisions.push({
      id: nextDecisionId(o.agent),
      agent: o.agent,
      kind: o.agent === "security" ? "security" : "product",
      claim: o.ask,
      rationale: `Reconciled objection against ${o.againstId}.`,
      refs: [o.againstId],
    });
  }
  log(ctx, {
    event: "reconciled",
    detail: `${blocking.length} blocking objection(s) promoted to binding decisions`,
  });
}
