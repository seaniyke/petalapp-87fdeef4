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

/* ------------------------------------------------------------------ */
/* Conversation messages — the SAME budget, applied to the message list */
/* ------------------------------------------------------------------ */
/*
 * This is the single context-budget module. `applyContextBudget` decides
 * which optional system-prompt sections survive; `budgetMessages` then fits
 * the conversation around that (already budgeted, pinned) system prompt
 * under the same ceiling. It never truncates or rewrites the system prompt,
 * so no section is cut twice. (Replaces the old context-budget.server.ts
 * pass, which used a separate per-model table and could swap models.)
 */

type Role = "system" | "user" | "assistant" | "tool";
type ContentPart = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

export interface BudgetMessage {
  role: Role;
  content: ContentPart;
}

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

function partLength(part: ContentPart): number {
  if (typeof part === "string") return part.length;
  let total = 0;
  for (const p of part) {
    if (p.type === "text" && p.text) total += p.text.length;
    // Images are billed separately; count ~1500 tokens to be safe.
    if (p.type === "image_url") total += 1500 * 4;
  }
  return total;
}

function estimateMessageTokens(m: BudgetMessage): number {
  return Math.ceil(partLength(m.content) / 4) + PER_MESSAGE_OVERHEAD_TOKENS;
}

export function estimateMessagesTokens(messages: BudgetMessage[]): number {
  let sum = 0;
  for (const m of messages) sum += estimateMessageTokens(m);
  return sum;
}

const CONSTRAINT_RE =
  /\b(always|never|don'?t|do not|must|make sure|remember|from now on|instead of|stop|i hate|i don'?t (like|want)|prefer|keep|use only|brand|our colou?rs?|font|logo|no (dark|light) mode)\b/i;

/** A message stating something Kimble must keep obeying (outranks recency). */
export function carriesConstraint(m: BudgetMessage): boolean {
  const text =
    typeof m.content === "string"
      ? m.content
      : m.content
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text as string)
          .join(" ");
  if (text.length > 2_000) return false;
  return CONSTRAINT_RE.test(text);
}

export interface MessageBudgetReport<M extends BudgetMessage> {
  messages: M[];
  estimatedTokens: number;
  budget: number;
  droppedCount: number;
}

/**
 * Keep, in priority order: system messages, the current user message,
 * constraint carriers (any age), the latest assistant turn, then recent
 * history newest-first. System + current message are never dropped.
 */
export function budgetMessages<M extends BudgetMessage>(messages: M[], budgetTokens: number): MessageBudgetReport<M> {
  const estimated = estimateMessagesTokens(messages);
  if (estimated <= budgetTokens) {
    return { messages, estimatedTokens: estimated, budget: budgetTokens, droppedCount: 0 };
  }
  let lastUserIdx = messages.length - 1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === "user") { lastUserIdx = i; break; }
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === "assistant") { lastAssistantIdx = i; break; }
  const priorityOf = (m: M, i: number) =>
    i === 0 || m.role === "system" ? 0 : i === lastUserIdx ? 1 : m.role === "user" && carriesConstraint(m) ? 2 : i === lastAssistantIdx ? 3 : 4;
  const ranked = messages
    .map((m, i) => ({ i, p: priorityOf(m, i), t: estimateMessageTokens(m) }))
    .sort((a, b) => (a.p === b.p ? b.i - a.i : a.p - b.p));
  const keep = new Set<number>();
  let running = 0;
  for (const r of ranked) {
    if (r.p <= 1 || running + r.t <= budgetTokens) {
      keep.add(r.i);
      running += r.t;
    }
  }
  const filtered = messages.filter((_, i) => keep.has(i));
  return {
    messages: filtered,
    estimatedTokens: estimateMessagesTokens(filtered),
    budget: budgetTokens,
    droppedCount: messages.length - filtered.length,
  };
}

/**
 * Pre-budget history retention for generation. Keeps the latest user message,
 * the two preceding messages for bare confirmations ("yes", "do it"), and any
 * earlier user message that carries a standing constraint. Everything else is
 * left out; budgetMessages() then fits what remains to the token ceiling.
 */
export function selectHistoryForGeneration<M extends BudgetMessage>(
  messages: M[],
  lastUserIdx: number,
  needsPreviousContext: boolean,
): M[] {
  if (lastUserIdx < 0) return messages.slice(-4);
  const keep = new Set<number>([lastUserIdx]);
  if (needsPreviousContext) {
    for (let i = Math.max(0, lastUserIdx - 2); i < lastUserIdx; i++) keep.add(i);
  }
  for (let i = 0; i < lastUserIdx; i++) {
    if (messages[i].role === "user" && carriesConstraint(messages[i])) keep.add(i);
  }
  return messages.filter((_, i) => keep.has(i));
}
