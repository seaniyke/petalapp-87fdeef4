/**
 * Kimble Intelligence — agent execution lifecycle.
 *
 * Runs the selected agents wave by wave: parallel inside a wave, sequential
 * across waves. Owns retries, timeouts, budget, graceful degradation and the
 * decision log. It knows nothing about any specific agent — only the registry
 * contract — so a new specialist never touches this file.
 *
 * Hard rule, same as every other Kimble layer: a failing OPTIONAL agent can
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
import { mergeAgentOutputs, runModelAgent, shouldEscalate } from "./model-agent.server";
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
      const view = agentView(ctx);
      const deterministic = await withTimeout(
        Promise.resolve(spec.run(view)),
        spec.timeoutMs,
        name,
      );
      // Phase 3 — model escalation. The deterministic body is the floor; on
      // structural turns the specialist may also think for itself. Any failure
      // (or a disabled flag) returns null and we keep the floor.
      let out = deterministic;
      if (shouldEscalate(spec, view)) {
        const extra = await withTimeout(
          runModelAgent(spec, view).catch(() => null),
          spec.timeoutMs,
          `${name} (model)`,
        ).catch(() => null);
        out = mergeAgentOutputs(deterministic, extra);
      }
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
 * Reconciliation (Engine 3.0, phase 3).
 *
 * Agents contradict each other; precedence decides, and the precedence order
 * is fixed and explicit rather than emergent:
 *
 *   product > security > architecture > data > ux > design > qa
 *
 * Rules, in order:
 *  1. A BLOCKING objection from an agent that outranks the decision's owner
 *     supersedes that decision: the original is struck from the board so the
 *     generation prompt can never carry both sides of a contradiction.
 *  2. Every blocking objection is promoted to a binding decision owned by the
 *     objecting agent, so its ask reaches the model as a requirement.
 *  3. A blocking objection from a LOWER-ranked agent cannot strike the
 *     decision — it is still promoted as an additional requirement, which is
 *     how "design wants this, product owns it" resolves without a stalemate.
 *  4. Identical asks collapse; boards routinely produce the same objection
 *     from two specialists.
 */
const PRECEDENCE: AgentName[] = [
  "product",
  "security",
  "architecture",
  "database",
  "backend",
  "ai_logic",
  "ux",
  "frontend",
  "responsive",
  "design",
  "qa",
];

function rank(agent: AgentName): number {
  const i = PRECEDENCE.indexOf(agent);
  return i === -1 ? PRECEDENCE.length : i;
}

export function reconcile(ctx: TurnContext): void {
  const blocking = ctx.objections.filter((o) => o.severity === "blocking");
  const superseded = new Set<string>();
  const promoted: string[] = [];
  const seenAsks = new Set<string>();

  for (const o of blocking) {
    const target = ctx.decisions.find((d) => d.id === o.againstId);
    if (target && rank(o.agent) < rank(target.agent)) superseded.add(target.id);

    const key = o.ask.trim().toLowerCase();
    if (seenAsks.has(key)) continue;
    seenAsks.add(key);
    promoted.push(o.ask);
    ctx.decisions.push({
      id: nextDecisionId(o.agent),
      agent: o.agent,
      kind: o.agent === "security" ? "security" : "product",
      claim: o.ask,
      rationale: target
        ? `Reconciled: overrides ${target.id} (${target.agent}).`
        : `Reconciled objection against ${o.againstId}.`,
      refs: [o.againstId],
    });
  }

  if (superseded.size > 0) {
    ctx.decisions = ctx.decisions.filter((d) => !superseded.has(d.id));
  }

  log(ctx, {
    event: "reconciled",
    detail: `${promoted.length} blocking objection(s) promoted, ${superseded.size} decision(s) superseded`,
    data: { promoted: promoted.length, superseded: superseded.size },
  });
}

