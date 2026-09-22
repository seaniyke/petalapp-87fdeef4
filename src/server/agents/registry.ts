/**
 * Kimble Intelligence — agent registry.
 *
 * Every specialist is declared here with the same shape: purpose,
 * capabilities, dependencies, model profile, budget, and whether the turn can
 * survive without it. The runtime knows nothing about any specific agent; it
 * only knows this contract. Adding a specialist is a registry entry, never a
 * change to the orchestrator.
 *
 * Phase 1 implementations are deliberately DETERMINISTIC: each agent derives
 * its decisions from the PRD (which is already model-authored upstream) plus
 * the brief. That gives real cross-agent collaboration at ~zero marginal cost
 * and zero latency, and leaves a clean seam for model escalation per agent in
 * a later phase (`modelProfile` is already declared and already routed).
 */

import type {
  AgentName,
  AgentOutput,
  AgentView,
  ExecutionProfile,
} from "./context";
import { decisionsOfKind } from "./context";

/** Which model tier an agent asks for when it escalates. */
export type ModelProfile = "deterministic" | "cheap" | "balanced" | "deep";

export interface AgentSpec {
  name: AgentName;
  purpose: string;
  capabilities: string[];
  /** Agents that must complete before this one starts. */
  dependsOn: AgentName[];
  modelProfile: ModelProfile;
  /** Per-agent spend ceiling, micro-USD. Deterministic agents declare 0. */
  budgetMicroUsd: number;
  timeoutMs: number;
  maxAttempts: number;
  /** False = a failure here fails the planning phase. */
  optional: boolean;
  /** Profiles this agent participates in at all. */
  profiles: ExecutionProfile[];
  run: (ctx: AgentView) => Promise<AgentOutput> | AgentOutput;
}

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

const has = (text: string, ...needles: string[]) => {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n));
};

function surfaces(ctx: AgentView): string[] {
  return (ctx.prd?.requiredSurfaces ?? []) as string[];
}

function entities(ctx: AgentView): string[] {
  return (ctx.prd?.dataModel ?? []).map((e) => String((e as { name?: string }).name ?? "")).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

const product: AgentSpec = {
  name: "product",
  purpose: "Own what the product is and how we will know it was built.",
  capabilities: ["purpose", "target users", "core problem", "key features", "acceptance"],
  dependsOn: [],
  modelProfile: "balanced",
  budgetMicroUsd: 5000,
  timeoutMs: 9000,
  maxAttempts: 2,
  optional: false,
  profiles: ["micro", "standard", "full"],
  run: (ctx) => {
    const prd = ctx.prd;
    if (!prd) {
      return {
        decisions: [
          {
            kind: "product",
            claim: `Deliver exactly what the request asks for: ${ctx.input.prompt.slice(0, 160)}`,
            rationale: "No PRD available; fall back to the literal brief.",
          },
        ],
      };
    }
    const out: AgentOutput = { decisions: [] };
    out.decisions!.push({
      kind: "product",
      claim: `Product is "${prd.productName}" — ${prd.purpose}`,
      rationale: `For ${prd.targetUser}. Primary outcome: ${prd.primaryOutcome}.`,
      data: { productType: prd.productType, domain: prd.domain },
    });
    out.decisions!.push({
      kind: "product",
      claim: `Primary workflow must work end to end: ${String(
        (prd.primaryWorkflow as { name?: string })?.name ?? "the core task",
      )}`,
    });
    if (prd.outOfScope.length) {
      out.decisions!.push({
        kind: "product",
        claim: `Out of scope this build: ${prd.outOfScope.slice(0, 4).join("; ")}`,
      });
    }
    return out;
  },
};

const ux: AgentSpec = {
  name: "ux",
  purpose: "Own information architecture, flows and every non-happy UI state.",
  capabilities: ["IA", "navigation", "onboarding", "flows", "empty/loading/error states"],
  dependsOn: ["product"],
  modelProfile: "cheap",
  budgetMicroUsd: 3000,
  timeoutMs: 9000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const list = surfaces(ctx);
    const decisions: AgentOutput["decisions"] = [];
    if (list.length) {
      decisions.push({
        kind: "ux",
        claim: `Ship exactly these surfaces: ${list.join(", ")} — invent no others.`,
        data: { surfaces: list },
      });
    }
    decisions.push({
      kind: "ux",
      claim: `Navigation: ${ctx.prd?.navigation ?? "single top nav with a working mobile drawer"}`,
    });
    const states = ctx.prd?.states?.length
      ? ctx.prd.states
      : ["loading", "empty", "error", "success"];
    decisions.push({
      kind: "ux",
      claim: `Every data surface renders all of: ${states.join(", ")}. No blank screens.`,
      data: { states },
    });
    if (ctx.prd?.needsAuth) {
      decisions.push({
        kind: "ux",
        claim: "First-run: unauthenticated visitors land on a real value screen, not a bare login form.",
      });
    }
    return { decisions };
  },
};

const design: AgentSpec = {
  name: "design",
  purpose: "Commit to one intentional visual direction and defend it.",
  capabilities: ["visual direction", "typography", "palette", "density", "motion", "layout"],
  dependsOn: ["product"],
  modelProfile: "balanced",
  budgetMicroUsd: 5000,
  timeoutMs: 9000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const d = ctx.design;
    const decisions: AgentOutput["decisions"] = [];
    if (d) {
      decisions.push({
        kind: "design",
        claim: `Visual direction "${d.vibe}": ${d.display_font} display + ${d.body_font} body, ${d.palette_mood}, ${d.density} density, ${d.motion} motion.`,
        rationale: d.rationale,
        data: {
          vibe: d.vibe,
          display_font: d.display_font,
          body_font: d.body_font,
          palette: d.palette_mood,
          density: d.density,
          motion: d.motion,
          theme: d.theme ?? null,
          template: d.template ?? null,
        },
      });
      if (d.design_moves?.length) {
        decisions.push({
          kind: "design",
          claim: `Commit to these design moves: ${d.design_moves.slice(0, 4).join("; ")}`,
        });
      }
    } else {
      decisions.push({
        kind: "design",
        claim:
          "No committed direction yet — pick one bold, product-appropriate direction and hold it across every surface.",
      });
    }
    // Anti-sameness guard, stated as a binding decision rather than prose.
    decisions.push({
      kind: "design",
      claim:
        "Reject generic-AI output: no wall of identical rounded cards, no purple-on-white gradient hero, no glassmorphism by default, no decorative element without a job.",
    });
    return { decisions };
  },
};

const architecture: AgentSpec = {
  name: "architecture",
  purpose: "Own routes, file ownership, shared components and library choices.",
  capabilities: ["route map", "module ownership", "libraries", "data flow"],
  dependsOn: ["product", "ux"],
  modelProfile: "balanced",
  budgetMicroUsd: 5000,
  timeoutMs: 9000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const list = surfaces(ctx);
    const decisions: AgentOutput["decisions"] = [];
    if (list.length) {
      decisions.push({
        kind: "architecture",
        claim: `One route per surface, one owning file per route (${list.length} routes). No duplicate page owning the same path.`,
        refs: decisionsOfKind(ctx, "ux").map((d) => d.id),
        data: { routes: list },
      });
    }
    decisions.push({
      kind: "architecture",
      claim:
        "Shared shell (nav + footer) is defined once and reused; page files never redeclare the shell.",
    });
    if (ctx.prd?.needsPersistence) {
      decisions.push({
        kind: "architecture",
        claim: "Data access goes through one typed client module; pages never inline raw queries.",
      });
    }
    return { decisions };
  },
};

const database: AgentSpec = {
  name: "database",
  purpose: "Own entities, relations and row-level access.",
  capabilities: ["schema", "relations", "RLS", "seed shape"],
  dependsOn: ["product", "architecture"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 4_000,
  maxAttempts: 2,
  optional: true,
  profiles: ["full"],
  run: (ctx) => {
    if (!ctx.prd?.needsPersistence) {
      return {
        decisions: [
          { kind: "data", claim: "No database this build — state stays local to the client." },
        ],
      };
    }
    const names = entities(ctx);
    const decisions: AgentOutput["decisions"] = [
      {
        kind: "data",
        claim: names.length
          ? `Entities: ${names.join(", ")}. Every table gets GRANTs, RLS enabled, and owner-scoped policies.`
          : "Persisted entities required — define them before writing UI that reads them.",
        data: { entities: names },
      },
    ];
    if (ctx.prd.needsAuth) {
      decisions.push({
        kind: "data",
        claim: "Every user-owned row carries a user_id and is filtered by auth.uid() in policy, not in the client.",
      });
    }
    return { decisions };
  },
};

const backend: AgentSpec = {
  name: "backend",
  purpose: "Own server-side contracts: endpoints, mutations, integrations.",
  capabilities: ["API surface", "mutations", "integrations", "server boundaries"],
  dependsOn: ["database"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 4_000,
  maxAttempts: 2,
  optional: true,
  profiles: ["full"],
  run: (ctx) => {
    if (!ctx.prd?.needsPersistence) return { decisions: [] };
    const names = entities(ctx);
    return {
      decisions: [
        {
          kind: "api",
          claim: names.length
            ? `CRUD contract per entity (${names.join(", ")}): list, read, create, update, delete — each with loading and error handling wired to the UI.`
            : "Define the read/write contract before any page consumes it.",
          refs: decisionsOfKind(ctx, "data").map((d) => d.id),
        },
        {
          kind: "api",
          claim: "Secrets and privileged calls stay server-side; the browser never holds a service key.",
        },
      ],
    };
  },
};

const security: AgentSpec = {
  name: "security",
  purpose: "Evaluate auth, authorization, sensitive data and payment exposure.",
  capabilities: ["authn", "authz", "PII", "payment risk", "RLS review"],
  dependsOn: ["database", "backend"],
  modelProfile: "cheap",
  budgetMicroUsd: 3000,
  timeoutMs: 9000,
  maxAttempts: 2,
  optional: true,
  profiles: ["full"],
  run: (ctx) => {
    const decisions: AgentOutput["decisions"] = [];
    const objections: AgentOutput["objections"] = [];
    const prompt = ctx.input.prompt;
    const money = has(prompt, "payment", "checkout", "wallet", "bank", "fintech", "invoice", "payout", "crypto");
    const pii = has(prompt, "kyc", "passport", "id card", "health", "medical", "patient", "address");

    if (ctx.prd?.needsAuth) {
      decisions.push({
        kind: "security",
        claim: "Authenticated routes are gated server-side; a client-only redirect is not a gate.",
      });
      decisions.push({
        kind: "security",
        claim: "Roles live in a dedicated role table, never on the profile row.",
      });
    }
    if (money) {
      decisions.push({
        kind: "security",
        claim: "Money movement: amounts are computed and verified server-side; the client never sets a final price.",
      });
      // Cross-agent objection: money without persistence/auth is incoherent.
      if (!ctx.prd?.needsAuth) {
        const target = decisionsOfKind(ctx, "product")[0];
        if (target) {
          objections.push({
            againstId: target.id,
            severity: "blocking",
            ask: "This product moves money but has no authentication — add an auth surface and per-user ownership.",
          });
        }
      }
    }
    if (pii) {
      decisions.push({
        kind: "security",
        claim: "Sensitive personal data is never rendered in public routes or logged.",
      });
    }
    return { decisions, objections };
  },
};

const aiLogic: AgentSpec = {
  name: "ai_logic",
  purpose: "Own business rules, computations, state machines and edge cases.",
  capabilities: ["formulas", "workflows", "state", "edge cases"],
  dependsOn: ["product"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 4_000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const decisions: AgentOutput["decisions"] = [];
    const formulas = ctx.prd?.formulas ?? [];
    for (const f of formulas.slice(0, 6)) {
      const example = f.example
        ? ` (e.g. ${f.example.input} → ${f.example.expected})`
        : "";
      decisions.push({
        kind: "logic",
        claim: `Implement ${f.id} exactly: ${f.statement}${example}`,
      });
    }
    if (has(ctx.input.prompt, "ai ", "assistant", "chatbot", "summariz", "generate ")) {
      decisions.push({
        kind: "logic",
        claim: "AI features call the model server-side, stream results, and render a real error state on failure.",
      });
    }
    decisions.push({
      kind: "logic",
      claim: "Every input is validated before use; invalid input shows an inline message, never a crash.",
    });
    return { decisions };
  },
};

const responsive: AgentSpec = {
  name: "responsive",
  purpose: "Own the breakpoint contract and the phone experience.",
  capabilities: ["breakpoints", "touch targets", "overflow", "mobile nav"],
  dependsOn: ["ux", "design"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 3_000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: () => ({
    decisions: [
      {
        kind: "responsive",
        claim:
          "Design mobile-first at 390px: no horizontal overflow, tap targets ≥44px, mobile nav actually opens and closes.",
      },
      {
        kind: "responsive",
        claim: "Type and spacing scale by breakpoint — desktop values are never shipped unscaled to phones.",
      },
    ],
  }),
};

const frontend: AgentSpec = {
  name: "frontend",
  purpose: "Turn the board into a concrete, dependency-ordered file plan.",
  capabilities: ["component plan", "file plan", "implementation order"],
  dependsOn: ["architecture", "design", "responsive"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 4_000,
  maxAttempts: 2,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const order: string[] = [];
    if (ctx.prd?.needsPersistence) order.push("data layer", "auth");
    order.push("app shell", "primary surface");
    const rest = surfaces(ctx).filter((s) => s !== "landing" && s !== "tool");
    if (rest.length) order.push(...rest);
    order.push("responsive pass", "QA");
    return {
      decisions: [
        {
          kind: "build_plan",
          claim: `Implementation order: ${order.join(" → ")}`,
          data: { order },
          refs: decisionsOfKind(ctx, "architecture").map((d) => d.id),
        },
      ],
    };
  },
};

const qa: AgentSpec = {
  name: "qa",
  purpose: "Declare, before code exists, what would make this build a failure.",
  capabilities: ["acceptance checks", "defect budget", "gate definition"],
  dependsOn: ["product", "frontend"],
  modelProfile: "deterministic",
  budgetMicroUsd: 0,
  timeoutMs: 3_000,
  maxAttempts: 1,
  optional: true,
  profiles: ["standard", "full"],
  run: (ctx) => {
    const checks = (ctx.prd?.acceptance ?? [])
      .map((a) => String((a as { statement?: string }).statement ?? ""))
      .filter(Boolean)
      .slice(0, 8);
    const decisions: AgentOutput["decisions"] = [
      {
        kind: "qa_plan",
        claim: checks.length
          ? `Build fails unless every one of these holds: ${checks.join(" | ")}`
          : "Build fails if the primary workflow cannot be completed end to end in the preview.",
        data: { checks },
      },
      {
        kind: "qa_plan",
        claim: "Also gate on: no console errors, every nav link resolves, no horizontal overflow at 390px.",
      },
    ];
    return { decisions };
  },
};

export const AGENT_REGISTRY: Record<AgentName, AgentSpec> = {
  product,
  ux,
  design,
  architecture,
  database,
  backend,
  security,
  ai_logic: aiLogic,
  responsive,
  frontend,
  qa,
};

export function getAgent(name: AgentName): AgentSpec {
  return AGENT_REGISTRY[name];
}

export const ALL_AGENTS: AgentName[] = Object.keys(AGENT_REGISTRY) as AgentName[];
