/**
 * Petal Intelligence — profile + agent selection.
 *
 * The whole point: a colour tweak must not convene a design board, and a
 * fintech SaaS must not be planned by a landing-page brain. Selection is
 * deterministic (regex + PRD shape), sub-millisecond, and explains itself —
 * every decision is logged so the /admin surface can show why an agent ran.
 */

import type { AgentName, ExecutionProfile, TurnContext } from "./context";
import { AGENT_REGISTRY, ALL_AGENTS } from "./registry";

export interface SelectionResult {
  profile: ExecutionProfile;
  agents: AgentName[];
  /** Human-readable reason, logged and shown in admin telemetry. */
  reason: string;
  complexity: number;
}

const TRIVIAL = /^(change|update|rename|fix|make|set|adjust|tweak|move|remove|delete)\b/i;
const COSMETIC =
  /\b(colou?r|font|text|copy|wording|headline|label|padding|margin|spacing|size|icon|logo|title)\b/i;

const BACKEND_HINTS =
  /\b(login|sign ?up|auth|account|user|dashboard|admin|database|save|store|crud|record|inventory|order|booking|subscription|payment|checkout|invoice|wallet|api|integration|realtime|upload)\b/i;
const HIGH_STAKES =
  /\b(fintech|bank|neobank|payment|payout|wallet|crypto|trading|invest|lending|insurance|health|medical|patient|kyc|payroll)\b/i;
const MULTI_ROLE = /\b(marketplace|multi[- ]tenant|vendor|seller|buyer|driver|rider|agent|staff|team|roles?)\b/i;

/** 0–10. Drives the profile and which optional agents get invited. */
export function scoreComplexity(ctx: TurnContext): number {
  const p = ctx.input.prompt;
  let score = 0;
  if (ctx.isInitial) score += 2;
  if (p.length > 240) score += 1;
  if (p.length > 900) score += 1;
  if (BACKEND_HINTS.test(p)) score += 2;
  if (HIGH_STAKES.test(p)) score += 2;
  if (MULTI_ROLE.test(p)) score += 1;
  if (ctx.prd?.needsPersistence) score += 1;
  if (ctx.prd?.needsAuth) score += 1;
  if ((ctx.prd?.requiredSurfaces?.length ?? 0) >= 5) score += 1;
  if ((ctx.prd?.dataModel?.length ?? 0) >= 3) score += 1;
  if (!ctx.isInitial && TRIVIAL.test(p.trim()) && COSMETIC.test(p) && p.length < 160) score -= 4;
  return Math.max(0, Math.min(10, score));
}

export function selectAgents(ctx: TurnContext): SelectionResult {
  const complexity = scoreComplexity(ctx);

  let profile: ExecutionProfile;
  if (complexity <= 1) profile = "micro";
  else if (complexity <= 5) profile = "standard";
  else profile = "full";

  const eligible = ALL_AGENTS.filter((name) =>
    AGENT_REGISTRY[name].profiles.includes(profile),
  );

  const wantsBackend =
    Boolean(ctx.prd?.needsPersistence) ||
    Boolean(ctx.prd?.needsAuth) ||
    BACKEND_HINTS.test(ctx.input.prompt);
  const wantsSecurity =
    wantsBackend || HIGH_STAKES.test(ctx.input.prompt) || Boolean(ctx.prd?.needsAuth);

  const agents = eligible.filter((name) => {
    if ((name === "database" || name === "backend") && !wantsBackend) return false;
    if (name === "security" && !wantsSecurity) return false;
    return true;
  });

  // Dependency closure: never invite an agent without its prerequisites.
  const selected = new Set<AgentName>(agents);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Array.from(selected)) {
      for (const dep of AGENT_REGISTRY[name].dependsOn) {
        if (!selected.has(dep)) {
          // Only pull in a dependency the profile allows; otherwise drop the
          // dependent agent rather than silently running an unplanned one.
          if (AGENT_REGISTRY[dep].profiles.includes(profile)) {
            selected.add(dep);
          } else {
            selected.delete(name);
          }
          changed = true;
        }
      }
    }
  }

  const ordered = ALL_AGENTS.filter((n) => selected.has(n));
  const reason =
    profile === "micro"
      ? "Small, well-scoped edit — planning board skipped, deterministic path only."
      : profile === "standard"
        ? "Ordinary product work — product/UX/design/architecture board."
        : `Complex product (${wantsBackend ? "stateful" : "stateless"}${
            HIGH_STAKES.test(ctx.input.prompt) ? ", high-stakes domain" : ""
          }) — full board.`;

  return { profile, agents: ordered, reason, complexity };
}

/**
 * Group the selected agents into dependency-ordered waves. Agents inside a
 * wave are independent and run in parallel; waves run sequentially.
 */
export function planWaves(agents: AgentName[]): AgentName[][] {
  const remaining = new Set(agents);
  const done = new Set<AgentName>();
  const waves: AgentName[][] = [];

  while (remaining.size > 0) {
    const wave = Array.from(remaining).filter((name) =>
      AGENT_REGISTRY[name].dependsOn.every((d) => done.has(d) || !agents.includes(d)),
    );
    if (wave.length === 0) {
      // Cycle or unsatisfiable dependency — run the rest sequentially rather
      // than hanging. Should be impossible; defensive by design.
      waves.push(Array.from(remaining));
      break;
    }
    waves.push(wave);
    for (const n of wave) {
      remaining.delete(n);
      done.add(n);
    }
  }
  return waves;
}
