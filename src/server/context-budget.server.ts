/**
 * Context-budget pre-check.
 *
 * Estimates the token cost of an assembled OpenAI-compatible `messages[]`
 * payload BEFORE we send it to the gateway. If the estimate exceeds the
 * target model's safe input window, we either:
 *   1. Suggest a larger-context model known to work for tool-call generation, OR
 *   2. Truncate the OLDEST non-system messages until the payload fits,
 *      preserving the system prompt and the most recent user turn (which
 *      typically carries the actual instruction + attachments).
 *
 * Why this exists: silent context-overflow is the #2 source of "the model
 * did nothing" failures after prose-only bailouts. The gateway returns
 * either a 4xx that's hard to parse or a truncated/empty completion. A
 * cheap pre-check eliminates the entire failure mode.
 *
 * Token estimation is intentionally a heuristic (chars/4 with a small
 * overhead per message). Real tokenizers add ~30 KB to the worker bundle
 * for marginal accuracy gains; a conservative estimate is enough to keep
 * us under the safe ceiling.
 */

type Role = "system" | "user" | "assistant" | "tool";

type ContentPart =
  | string
  | Array<{ type: string; text?: string; image_url?: { url: string } }>;

export interface BudgetMessage {
  role: Role;
  content: ContentPart;
}

export interface BudgetResult {
  /** Estimated input tokens for the payload (rough). */
  estimatedTokens: number;
  /** The model's safe input window (tokens we're willing to spend on input). */
  safeInputTokens: number;
  /** True if estimatedTokens exceeded safeInputTokens before any action. */
  overBudget: boolean;
  /** Messages after any truncation. Same array if no action taken. */
  messages: BudgetMessage[];
  /** A different model to use, or null to keep the original. */
  modelOverride: string | null;
  /** How many oldest non-system messages were dropped, if any. */
  droppedCount: number;
  /** Human-readable reason for telemetry/logs. */
  action: "none" | "model_upgrade" | "truncate" | "model_upgrade+truncate";
}

/**
 * Conservative per-model SAFE INPUT windows (tokens). Real context windows
 * are larger — we leave a generous output buffer so the model has room to
 * write the response without the gateway truncating it.
 */
const SAFE_INPUT_TOKENS: Record<string, number> = {
  // Gemini 2.5 family: 1M context, but we cap aggressively because long
  // contexts hurt tool-call discipline (this is the prose-only failure).
  "google/gemini-2.5-pro": 200_000,
  "google/gemini-2.5-flash": 200_000,
  "google/gemini-2.5-flash-lite": 100_000,
  "google/gemini-3-flash-preview": 200_000,
  "google/gemini-3.1-pro-preview": 250_000,
  // GPT-5 family: 400K context window; safe input ~250K leaves room for output.
  "openai/gpt-5": 250_000,
  "openai/gpt-5-mini": 200_000,
  "openai/gpt-5-nano": 100_000,
  "openai/gpt-5.2": 250_000,
};

/** Model upgrades when the current pick can't fit the payload. */
const LARGER_CONTEXT_ALTERNATIVE: Record<string, string> = {
  "google/gemini-3-flash-preview": "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-flash": "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-flash-lite": "google/gemini-2.5-flash",
  "google/gemini-2.5-pro": "google/gemini-3.1-pro-preview",
  "openai/gpt-5-mini": "google/gemini-3.1-pro-preview",
  "openai/gpt-5-nano": "openai/gpt-5-mini",
};

const DEFAULT_SAFE_INPUT = 100_000;
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

function partLength(part: ContentPart): number {
  if (typeof part === "string") return part.length;
  let total = 0;
  for (const p of part) {
    if (p.type === "text" && p.text) total += p.text.length;
    // Images are billed separately and don't count toward text-token budget
    // for our purposes here. Treat as ~1500 tokens to be safe.
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

export function safeInputTokensFor(model: string): number {
  return SAFE_INPUT_TOKENS[model] ?? DEFAULT_SAFE_INPUT;
}

/**
 * Apply the budget. Strategy:
 *   1. If estimate fits the current model → return as-is.
 *   2. Else if a larger-context alternative fits → swap model.
 *   3. Else truncate oldest non-system, non-last-user messages until it fits.
 *      System prompt (index 0) and the most recent user turn are pinned.
 */
export function applyContextBudget(
  messages: BudgetMessage[],
  model: string,
): BudgetResult {
  const safe = safeInputTokensFor(model);
  const estimated = estimateMessagesTokens(messages);
  if (estimated <= safe) {
    return {
      estimatedTokens: estimated,
      safeInputTokens: safe,
      overBudget: false,
      messages,
      modelOverride: null,
      droppedCount: 0,
      action: "none",
    };
  }

  // Try model upgrade first (no information loss).
  const upgrade = LARGER_CONTEXT_ALTERNATIVE[model];
  if (upgrade) {
    const upgradeSafe = safeInputTokensFor(upgrade);
    if (estimated <= upgradeSafe) {
      return {
        estimatedTokens: estimated,
        safeInputTokens: upgradeSafe,
        overBudget: true,
        messages,
        modelOverride: upgrade,
        droppedCount: 0,
        action: "model_upgrade",
      };
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Priority-ordered compression (AI Generation Bible §10).
  //
  // Recency is the WRONG axis to drop on: the oldest messages are where the
  // user stated their brand, their constraints and their rejections, and
  // dropping those makes Kimble re-propose ideas the user already refused.
  // The bible fixes the order — keep, in this priority:
  //
  //   1. the system prompt                       (rules, tokens, contracts)
  //   2. the user's current message              (the actual instruction)
  //   3. constraint / memory carriers            (any message that states a
  //      preference, rejection, brand or hard rule — at any age)
  //   4. the most recent assistant turn          (what we just did)
  //   5. recent history, newest first
  //   6. everything else                         (dropped first)
  //
  // "If context still doesn't fit, narrow the task, don't truncate the
  // constraints" — so constraint carriers are only dropped once every
  // ordinary message is already gone.
  // ────────────────────────────────────────────────────────────────────
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return messages.length - 1;
  })();

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  const targetSafe = upgrade ? safeInputTokensFor(upgrade) : safe;

  const priorityOf = (m: BudgetMessage, i: number): number => {
    if (i === 0 || m.role === "system") return 0;
    if (i === lastUserIdx) return 1;
    if (m.role === "user" && carriesConstraint(m)) return 2;
    if (i === lastAssistantIdx) return 3;
    return 4;
  };

  // Rank: lower priority number = keep harder. Within the same priority,
  // newer wins. Then fill the budget greedily in rank order.
  const ranked = messages
    .map((m, i) => ({ m, i, p: priorityOf(m, i), t: estimateMessageTokens(m) }))
    .sort((a, b) => (a.p === b.p ? b.i - a.i : a.p - b.p));

  const keep = new Set<number>();
  let running = 0;
  for (const r of ranked) {
    // The system prompt and the current instruction are never negotiable,
    // even if they alone blow the window — a caller that hits that has a
    // task-narrowing problem, not a truncation problem.
    const mandatory = r.p <= 1;
    if (mandatory || running + r.t <= targetSafe) {
      keep.add(r.i);
      running += r.t;
    }
  }

  const filtered = messages.filter((_, i) => keep.has(i));
  const droppedCount = messages.length - filtered.length;
  const finalEstimate = estimateMessagesTokens(filtered);

  return {
    estimatedTokens: finalEstimate,
    safeInputTokens: targetSafe,
    overBudget: true,
    messages: filtered,
    modelOverride: upgrade ?? null,
    droppedCount,
    action: upgrade ? "model_upgrade+truncate" : "truncate",
  };
}

/**
 * Does this message state something Kimble must keep obeying for the rest of
 * the project? Constraints outrank recency (§10) — a brand colour stated in
 * message 2 governs message 40.
 */
const CONSTRAINT_RE =
  /\b(always|never|don'?t|do not|must|make sure|remember|from now on|instead of|stop|i hate|i don'?t (like|want)|prefer|keep|use only|brand|our colou?rs?|font|logo|no (dark|light) mode)\b/i;

export function carriesConstraint(m: BudgetMessage): boolean {
  const text =
    typeof m.content === "string"
      ? m.content
      : m.content
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text as string)
          .join(" ");
  // Very long messages are usually pasted code/errors, not stated rules.
  if (text.length > 2_000) return false;
  return CONSTRAINT_RE.test(text);
}
