/**
 * Kimble Intelligence — model escalation for the planning board (Engine 3.0, phase 3).
 *
 * Phase 1 agents are deterministic: they restate the PRD as decisions. That is
 * cheap and reliable, but it can only ever repeat what an upstream pass already
 * knew. This module lets a specialist actually *think* on structural turns: it
 * gives one agent its own brief (purpose, capabilities, the board so far) and
 * asks for a small number of extra binding decisions and objections.
 *
 * Contract with the rest of the system:
 *  - Additive. The deterministic body always runs; the model output is merged
 *    on top. A model failure returns `null` and the turn is unchanged.
 *  - Bounded. Only runs on the `full` execution profile, only for agents whose
 *    registry entry declares a non-deterministic `modelProfile`, and only
 *    within the agent's own micro-USD budget.
 *  - Off switch: PETAL_AGENT_MODELS=0.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import type { AgentOutput, AgentView, DecisionKind, ObjectionSeverity } from "./context";
import type { AgentSpec, ModelProfile } from "./registry";

const MODEL_BY_PROFILE: Record<Exclude<ModelProfile, "deterministic">, string> = {
  cheap: "google/gemini-3.1-flash-lite",
  balanced: "google/gemini-3.8-flash",
  deep: "openai/gpt-5.6-sol",
};

const MAX_DECISIONS = 5;
const MAX_OBJECTIONS = 3;

const DECISION_KINDS: DecisionKind[] = [
  "product",
  "ux",
  "design",
  "architecture",
  "data",
  "api",
  "security",
  "logic",
  "responsive",
  "qa_plan",
  "build_plan",
];

const SEVERITIES: ObjectionSeverity[] = ["blocking", "concern", "note"];

export function agentModelsEnabled(): boolean {
  const raw = process.env["PETAL_AGENT_MODELS"];
  if (raw == null || raw === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

/** Only structural turns pay for thinking; a colour tweak never does. */
export function shouldEscalate(spec: AgentSpec, ctx: AgentView): boolean {
  if (!agentModelsEnabled()) return false;
  if (spec.modelProfile === "deterministic") return false;
  if (spec.budgetMicroUsd <= 0) return false;
  return ctx.profile === "full";
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/** Parse the model's JSON into board-shaped output. Never throws. */
export function parseAgentOutput(content: string, fallbackKind: DecisionKind): AgentOutput {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return {};
  }
  const root = parsed as { decisions?: unknown; objections?: unknown };
  const out: AgentOutput = {};

  if (Array.isArray(root.decisions)) {
    const decisions: NonNullable<AgentOutput["decisions"]> = [];
    for (const raw of root.decisions.slice(0, MAX_DECISIONS * 2)) {
      const item = raw as { kind?: unknown; claim?: unknown; rationale?: unknown };
      const claim = str(item?.claim, 240);
      if (!claim) continue;
      const kind = str(item?.kind, 24) as DecisionKind;
      decisions.push({
        kind: DECISION_KINDS.includes(kind) ? kind : fallbackKind,
        claim,
        rationale: str(item?.rationale, 200) || undefined,
      });
      if (decisions.length >= MAX_DECISIONS) break;
    }
    if (decisions.length) out.decisions = decisions;
  }

  if (Array.isArray(root.objections)) {
    const objections: NonNullable<AgentOutput["objections"]> = [];
    for (const raw of root.objections.slice(0, MAX_OBJECTIONS * 2)) {
      const item = raw as { againstId?: unknown; severity?: unknown; ask?: unknown };
      const ask = str(item?.ask, 240);
      const againstId = str(item?.againstId, 60);
      if (!ask || !againstId) continue;
      const severity = str(item?.severity, 12) as ObjectionSeverity;
      objections.push({
        againstId,
        severity: SEVERITIES.includes(severity) ? severity : "concern",
        ask,
      });
      if (objections.length >= MAX_OBJECTIONS) break;
    }
    if (objections.length) out.objections = objections;
  }

  return out;
}

function boardDigest(ctx: AgentView): string {
  if (ctx.decisions.length === 0) return "(the board is empty — you are first)";
  return ctx.decisions
    .slice(0, 24)
    .map((d) => `- [${d.id}] (${d.agent}/${d.kind}) ${d.claim}`)
    .join("\n");
}

function systemPrompt(spec: AgentSpec): string {
  return [
    `You are Kimble's ${spec.name} specialist on a multi-agent build board.`,
    `Your remit: ${spec.purpose}`,
    `You own: ${spec.capabilities.join(", ")}.`,
    "",
    "Add only what is MISSING from the board. Never restate a decision that is already there.",
    "Every decision must be one imperative line an engineer can implement and a reviewer can check.",
    "No taste notes, no encouragement, no restating the brief.",
    `Object to another agent's decision only when following it would produce a broken, unsafe, or unusable product. Use severity "blocking" only then.`,
    "",
    "Respond with JSON only:",
    `{"decisions":[{"kind":"${spec.name === "security" ? "security" : "product"}","claim":"...","rationale":"..."}],"objections":[{"againstId":"<decision id from the board>","severity":"blocking|concern|note","ask":"..."}]}`,
    `At most ${MAX_DECISIONS} decisions and ${MAX_OBJECTIONS} objections. Return {"decisions":[],"objections":[]} when the board is already sufficient.`,
  ].join("\n");
}

function userPrompt(ctx: AgentView): string {
  const prd = ctx.prd;
  return [
    `USER REQUEST: ${ctx.input.prompt.slice(0, 1500)}`,
    `TARGET: ${ctx.target} · ${ctx.isInitial ? "first build" : `existing project (${ctx.input.fileCount} files)`}`,
    prd
      ? `PRODUCT: ${prd.productName} — ${prd.purpose} (for ${prd.targetUser})`
      : "PRODUCT: not yet defined",
    ctx.design ? `DESIGN DIRECTION: ${JSON.stringify(ctx.design).slice(0, 600)}` : "",
    "",
    "BOARD SO FAR:",
    boardDigest(ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fallback decision kind per agent, used when the model omits/invents one. */
const KIND_BY_AGENT: Partial<Record<AgentSpec["name"], DecisionKind>> = {
  product: "product",
  ux: "ux",
  design: "design",
  architecture: "architecture",
  database: "data",
  backend: "api",
  frontend: "ux",
  security: "security",
  ai_logic: "logic",
  responsive: "responsive",
  qa: "qa_plan",
};

/**
 * Run one agent through a model. Returns `null` when escalation is off, the
 * call fails, or the model had nothing to add — callers keep the deterministic
 * output in every one of those cases.
 */
export async function runModelAgent(
  spec: AgentSpec,
  ctx: AgentView,
  signal?: AbortSignal,
): Promise<AgentOutput | null> {
  if (!shouldEscalate(spec, ctx)) return null;
  const model =
    MODEL_BY_PROFILE[spec.modelProfile as Exclude<ModelProfile, "deterministic">] ??
    MODEL_BY_PROFILE.balanced;

  try {
    const res = await aiChatCompletions({
      feature: "preflight",
      budgetAware: true,
      body: {
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: systemPrompt(spec) },
          { role: "user", content: userPrompt(ctx) },
        ],
      },
      signal,
      meta: {
        projectId: ctx.projectId ?? null,
        userId: null,
        phase: `agent-${spec.name}`,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseAgentOutput(text, KIND_BY_AGENT[spec.name] ?? "product");
    if (!parsed.decisions?.length && !parsed.objections?.length) return null;
    parsed.usage = {
      costMicroUsd: spec.budgetMicroUsd,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
    return parsed;
  } catch {
    return null;
  }
}

/** Merge model output onto deterministic output, dropping duplicate claims. */
export function mergeAgentOutputs(base: AgentOutput, extra: AgentOutput | null): AgentOutput {
  if (!extra) return base;
  const seen = new Set((base.decisions ?? []).map((d) => d.claim.toLowerCase()));
  const decisions = [...(base.decisions ?? [])];
  for (const d of extra.decisions ?? []) {
    const key = d.claim.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    decisions.push(d);
  }
  return {
    ...base,
    decisions,
    objections: [...(base.objections ?? []), ...(extra.objections ?? [])],
    usage: {
      costMicroUsd: (base.usage?.costMicroUsd ?? 0) + (extra.usage?.costMicroUsd ?? 0),
      tokensIn: (base.usage?.tokensIn ?? 0) + (extra.usage?.tokensIn ?? 0),
      tokensOut: (base.usage?.tokensOut ?? 0) + (extra.usage?.tokensOut ?? 0),
    },
  };
}
