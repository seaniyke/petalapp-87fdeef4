/**
 * Context budget. Every section is measured before the request is sent.
 * When over budget, optional sections are dropped lowest-priority first.
 * Required sections (system rules, the user's request, target files) are
 * never truncated or dropped here.
 */
import { estimateTokens } from "@/server/prompt-budget.server";

export type SectionPriority =
  | "required" // system instructions, request, target files
  | "project-state" // manifest / structure
  | "design" // relevant design intelligence
  | "memory" // resolved memory
  | "skills"
  | "history" // learning, older history, suggestions
  | "inference";

const RANK: Record<SectionPriority, number> = {
  required: 0,
  "project-state": 1,
  design: 2,
  memory: 3,
  skills: 4,
  history: 5,
  inference: 6,
};

export interface ContextSection {
  id: string;
  priority: SectionPriority;
  text: string;
}

export interface BudgetReport {
  kept: ContextSection[];
  dropped: string[];
  tokens: number;
  budget: number;
  perSection: Record<string, number>;
  overRequired: boolean;
}

export function applyContextBudget(sections: ContextSection[], budgetTokens: number): BudgetReport {
  const perSection: Record<string, number> = {};
  for (const s of sections) perSection[s.id] = estimateTokens(s.text);
  let total = sections.reduce((n, s) => n + perSection[s.id]!, 0);
  const dropped: string[] = [];
  const drop = new Set<string>();
  // Lowest priority first; within a priority, the largest first.
  const candidates = sections
    .filter((s) => s.priority !== "required" && s.text)
    .sort((a, b) => RANK[b.priority] - RANK[a.priority] || perSection[b.id]! - perSection[a.id]!);
  for (const s of candidates) {
    if (total <= budgetTokens) break;
    drop.add(s.id);
    dropped.push(s.id);
    total -= perSection[s.id]!;
  }
  return {
    kept: sections.filter((s) => !drop.has(s.id)),
    dropped,
    tokens: total,
    budget: budgetTokens,
    perSection,
    overRequired: total > budgetTokens,
  };
}
