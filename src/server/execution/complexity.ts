/**
 * Execution complexity — how heavy a turn is BEFORE expensive work begins.
 *
 * Extends the existing classifier/depth layer (never replaces it): the ONE
 * classification from `classifyRequest` plus deterministic facts about the
 * plan and project produce an internal class used for
 *   - execution strategy (e.g. which pages the WRITE stage decomposes),
 *   - the expected-cost baseline recorded with the turn's economics.
 * It never blocks work and never exposes labels to customers.
 */

export const EXECUTION_CLASSES = ["LIGHT", "STANDARD", "HEAVY", "COMPLEX", "ESCALATED"] as const;
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];

export interface ComplexityInput {
  isInitial: boolean;
  operation?: string | null;
  request: string;
  requirementCount: number;
  plannedPages: number;
  /** Files already in the project (0 on a first build). */
  existingFiles: number;
  crossCutting: boolean;
  backendInvolved: boolean;
  integrations: number;
  /** Raised when a constraint was hit mid-turn (truncation, provider failover). */
  escalations?: string[];
}

export interface ComplexitySignal {
  name: string;
  weight: number;
}

export interface ComplexityAssessment {
  class: ExecutionClass;
  score: number;
  signals: ComplexitySignal[];
  /** Expected variable AI cost (USD) for this class — a measurement baseline,
   *  compared against actual cost after the turn. Not a price. */
  expectedCostUsd: number;
  canDecompose: boolean;
}

/**
 * Expected-cost baselines per class, seeded from measured turns
 * (ai_call_log, DeepSeek V4 Flash via OpenRouter, Sept 2026): small edits
 * ~$0.002–0.006, feature turns ~$0.01, multi-page first builds $0.03–0.08.
 * Recorded next to the actual cost so the bands can be re-fit from data.
 */
export const EXPECTED_COST_USD: Record<ExecutionClass, number> = {
  LIGHT: 0.004,
  STANDARD: 0.012,
  HEAVY: 0.035,
  COMPLEX: 0.06,
  ESCALATED: 0.09,
};

const UI_HEAVY = /\b(dashboard|management|admin|crm|erp|portal|workflow|scheduling|booking|inventory|analytics|kanban|calendar|editor|builder|marketplace)\b/i;
const ARCH = /\b(refactor|migrate|restructure|rewrite|architecture|switch (to|from)|replace the)\b/i;

export function assessExecution(input: ComplexityInput): ComplexityAssessment {
  const s: ComplexitySignal[] = [];
  const add = (name: string, weight: number) => { if (weight) s.push({ name, weight }); };
  add("first_build", input.isInitial ? 2 : 0);
  add("requirements", Math.min(4, Math.max(0, input.requirementCount - 2)));
  add("pages", Math.min(3, Math.max(0, input.plannedPages - 2)));
  add("ui_heavy_domain", UI_HEAVY.test(input.request) ? 2 : 0);
  add("architectural", ARCH.test(input.request) || input.operation === "architectural_change" ? 3 : 0);
  add("dependency_change", input.operation === "dependency_change" ? 2 : 0);
  add("cross_cutting", input.crossCutting ? 2 : 0);
  add("backend", input.backendInvolved ? 2 : 0);
  add("integrations", Math.min(3, input.integrations));
  add("modifies_existing", !input.isInitial && input.existingFiles > 20 && (input.crossCutting || ARCH.test(input.request)) ? 1 : 0);
  add("micro_edit", input.operation === "content_change" || input.operation === "styling_change" ? -2 : 0);
  const score = s.reduce((a, x) => a + x.weight, 0);
  let cls: ExecutionClass = score <= 1 ? "LIGHT" : score <= 4 ? "STANDARD" : score <= 8 ? "HEAVY" : "COMPLEX";
  if (input.escalations && input.escalations.length > 0) {
    cls = "ESCALATED";
    for (const e of input.escalations) s.push({ name: `escalated:${e}`, weight: 0 });
  }
  return {
    class: cls,
    score,
    signals: s,
    expectedCostUsd: EXPECTED_COST_USD[cls],
    canDecompose: input.isInitial || input.plannedPages > 0,
  };
}

// ── Page decomposition decision (WRITE stage) ──────────────────────────────

export interface PageComplexityInput {
  route: string;
  file: string;
  request: string;
  requirementCount: number;
  pageCount: number;
  /** A previous candidate for this page was cut off by the output limit. */
  truncatedBefore?: boolean;
}

export interface PageDecision {
  decompose: boolean;
  reasons: string[];
  /** Folder that owns the page's section components. */
  sectionDir: string;
}

const SIMPLE_ROUTE = /^\/(about|contact|privacy|terms|faq|pricing|login|signup|sign-in|sign-up|404|not-found|thank-you|success)\b/i;

export function sectionDirFor(file: string): string {
  const name = file.split("/").pop()!.replace(/\.[jt]sx?$/, "");
  return `src/components/${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/**
 * Decompose only when evidence says one generation is risky: the page
 * previously hit the output limit, or it is the primary surface of a
 * multi-requirement, UI-heavy product. Simple pages always stay one file;
 * no byte threshold is used.
 */
export function assessPageComplexity(p: PageComplexityInput): PageDecision {
  const reasons: string[] = [];
  const sectionDir = sectionDirFor(p.file);
  if (p.truncatedBefore) reasons.push("output_limit_hit");
  if (SIMPLE_ROUTE.test(p.route)) return { decompose: reasons.length > 0, reasons, sectionDir };
  const primary = p.route === "/" || /dashboard|home|overview|index/i.test(p.route);
  const heavyDomain = UI_HEAVY.test(p.request) || UI_HEAVY.test(p.route);
  const perPage = p.requirementCount / Math.max(1, p.pageCount);
  if (primary && heavyDomain && p.requirementCount >= 4) reasons.push("primary_surface_of_multi_feature_product");
  else if (heavyDomain && perPage >= 3) reasons.push("dense_feature_page");
  return { decompose: reasons.length > 0, reasons, sectionDir };
}
