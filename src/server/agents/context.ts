/**
 * Petal Intelligence — shared agent context (the blackboard).
 *
 * Agents never talk to each other directly. Each one reads the context and
 * appends typed `Decision` records (and `Objection`s against other agents'
 * decisions). The orchestrator owns the context; agents receive a readonly
 * view and return a patch. That is the only communication channel, which is
 * what makes the whole thing replayable, testable and auditable.
 *
 * Nothing here talks to the network or the database — pure types + pure
 * helpers, so the whole layer is unit-testable without a live project.
 */

import type { Prd } from "@/server/prd/prd-types";
import type { DesignDirection } from "@/server/design-director.server";

export type AgentName =
  | "product"
  | "ux"
  | "design"
  | "architecture"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "ai_logic"
  | "responsive"
  | "qa";

/** How much machinery a turn deserves. Set by the selector, not by an agent. */
export type ExecutionProfile = "micro" | "standard" | "full";

export type DecisionKind =
  | "product"
  | "ux"
  | "design"
  | "architecture"
  | "data"
  | "api"
  | "security"
  | "logic"
  | "responsive"
  | "qa_plan"
  | "build_plan";

export interface Decision {
  id: string;
  agent: AgentName;
  kind: DecisionKind;
  /** One line, imperative, machine-readable enough to render into a prompt. */
  claim: string;
  /** Why. Kept short — this is context for other agents, not prose. */
  rationale?: string;
  /** Ids of decisions this one builds on. */
  refs?: string[];
  /** Free-form structured payload the consuming stage understands. */
  data?: Record<string, unknown>;
}

export type ObjectionSeverity = "blocking" | "concern" | "note";

export interface Objection {
  id: string;
  agent: AgentName;
  /** Decision id being objected to. */
  againstId: string;
  severity: ObjectionSeverity;
  /** What the objecting agent wants changed. */
  ask: string;
}

export type AgentStatus =
  | "pending"
  | "skipped"
  | "running"
  | "ok"
  | "degraded"
  | "failed";

export interface AgentRun {
  agent: AgentName;
  status: AgentStatus;
  attempts: number;
  ms: number;
  costMicroUsd: number;
  tokensIn: number;
  tokensOut: number;
  decisions: number;
  objections: number;
  error?: string;
  /** True when the agent failed but the turn continued anyway. */
  optional: boolean;
}

export interface OrchestratorLogEntry {
  at: number;
  event:
    | "profile_selected"
    | "agents_selected"
    | "batch_start"
    | "agent_start"
    | "agent_end"
    | "agent_retry"
    | "agent_skipped"
    | "budget_exhausted"
    | "reconciled"
    | "done";
  detail: string;
  data?: Record<string, unknown>;
}

/** The blackboard. One per turn. */
export interface TurnContext {
  turnId: string;
  projectId: string | null;
  userId: string | null;
  target: string;
  /** True on the project's first build. */
  isInitial: boolean;
  profile: ExecutionProfile;

  input: {
    prompt: string;
    /** Compact summary of prior turns; never the full transcript. */
    historyDigest?: string;
    fileCount: number;
  };

  /** Product contract. Owned by the product agent, read by everyone. */
  prd: Prd | null;
  /** Visual contract. Owned by the design agent. */
  design: DesignDirection | null;

  decisions: Decision[];
  objections: Objection[];
  runs: AgentRun[];
  log: OrchestratorLogEntry[];

  budget: {
    /** Hard ceiling for the whole planning phase, in micro-USD. */
    ceilingMicroUsd: number;
    spentMicroUsd: number;
    /** Wall-clock ceiling for the whole planning phase. */
    deadlineAt: number;
  };
}

export interface CreateContextArgs {
  turnId: string;
  prompt: string;
  projectId?: string | null;
  userId?: string | null;
  target?: string;
  isInitial?: boolean;
  fileCount?: number;
  historyDigest?: string;
  prd?: Prd | null;
  design?: DesignDirection | null;
  ceilingMicroUsd?: number;
  deadlineMs?: number;
  now?: number;
}

/** Default planning ceiling: 3 US cents and 25 seconds for the whole board. */
export const DEFAULT_PLANNING_CEILING_MICRO_USD = 30_000;
export const DEFAULT_PLANNING_DEADLINE_MS = 25_000;

export function createTurnContext(args: CreateContextArgs): TurnContext {
  const now = args.now ?? Date.now();
  return {
    turnId: args.turnId,
    projectId: args.projectId ?? null,
    userId: args.userId ?? null,
    target: args.target ?? "web",
    isInitial: args.isInitial ?? true,
    profile: "standard",
    input: {
      prompt: args.prompt,
      historyDigest: args.historyDigest,
      fileCount: args.fileCount ?? 0,
    },
    prd: args.prd ?? null,
    design: args.design ?? null,
    decisions: [],
    objections: [],
    runs: [],
    log: [],
    budget: {
      ceilingMicroUsd: args.ceilingMicroUsd ?? DEFAULT_PLANNING_CEILING_MICRO_USD,
      spentMicroUsd: 0,
      deadlineAt: now + (args.deadlineMs ?? DEFAULT_PLANNING_DEADLINE_MS),
    },
  };
}

/** Readonly slice handed to an agent. Agents cannot mutate the board. */
export type AgentView = Readonly<
  Pick<
    TurnContext,
    "turnId" | "projectId" | "target" | "isInitial" | "profile" | "input" | "prd" | "design"
  >
> & {
  readonly decisions: readonly Decision[];
  readonly objections: readonly Objection[];
};

export function agentView(ctx: TurnContext): AgentView {
  return {
    turnId: ctx.turnId,
    projectId: ctx.projectId,
    target: ctx.target,
    isInitial: ctx.isInitial,
    profile: ctx.profile,
    input: ctx.input,
    prd: ctx.prd,
    design: ctx.design,
    decisions: ctx.decisions,
    objections: ctx.objections,
  };
}

/** Everything an agent may hand back. All fields optional — partial work counts. */
export interface AgentOutput {
  decisions?: Array<Omit<Decision, "id" | "agent">>;
  objections?: Array<Omit<Objection, "id" | "agent">>;
  /** Agent-owned upgrades to the shared contracts. */
  prd?: Prd;
  design?: DesignDirection;
  /** Reported spend, when the agent actually called a model. */
  usage?: { costMicroUsd?: number; tokensIn?: number; tokensOut?: number };
}

export function decisionsBy(ctx: AgentView, agent: AgentName): readonly Decision[] {
  return ctx.decisions.filter((d) => d.agent === agent);
}

export function decisionsOfKind(ctx: AgentView, kind: DecisionKind): readonly Decision[] {
  return ctx.decisions.filter((d) => d.kind === kind);
}

let seq = 0;
export function nextDecisionId(agent: AgentName): string {
  seq = (seq + 1) % 1_000_000;
  return `${agent}-${seq.toString(36)}`;
}

/**
 * Renders the board into a compact prompt block. This is how agent
 * collaboration reaches the generation model without a giant prompt dump:
 * one line per decision, grouped by kind, capped.
 */
export function renderDecisionBlock(ctx: TurnContext, max = 40): string {
  if (ctx.decisions.length === 0) return "";
  const byKind = new Map<DecisionKind, Decision[]>();
  for (const d of ctx.decisions.slice(0, max)) {
    const list = byKind.get(d.kind) ?? [];
    list.push(d);
    byKind.set(d.kind, list);
  }
  const lines: string[] = ["AGREED BUILD DECISIONS (binding — do not contradict):"];
  for (const [kind, list] of byKind) {
    lines.push(`${kind.toUpperCase()}:`);
    for (const d of list) lines.push(`- ${d.claim}`);
  }
  const blocking = ctx.objections.filter((o) => o.severity === "blocking");
  if (blocking.length > 0) {
    lines.push("MUST ALSO SATISFY:");
    for (const o of blocking.slice(0, 8)) lines.push(`- ${o.ask}`);
  }
  return lines.join("\n");
}
