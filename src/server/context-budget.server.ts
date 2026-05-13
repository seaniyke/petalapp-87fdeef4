/**
 * Context-budget pre-check.
 *
 * Estimates the token cost of an assembled OpenAI-compatible `messages[]`
 * payload BEFORE we send it to the gateway. If the estimate exceeds the
 * target model's safe input window, we either:
 *   1. Suggest a larger-context model from the same family, OR
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

  // Truncate oldest non-system messages, keep last user turn.
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return messages.length - 1;
  })();

  const pinned = new Set<number>([0, lastUserIdx]);
  const kept: BudgetMessage[] = messages.map((m) => m);
  const droppedIdx: number[] = [];
  // Walk from oldest (1) toward last, dropping until we fit.
  let runningEstimate = estimated;
  const targetSafe = upgrade
    ? safeInputTokensFor(upgrade)
    : safe;
  for (let i = 1; i < kept.length && runningEstimate > targetSafe; i++) {
    if (pinned.has(i)) continue;
    runningEstimate -= estimateMessageTokens(kept[i]);
    droppedIdx.push(i);
  }
  const droppedSet = new Set(droppedIdx);
  const filtered = kept.filter((_, i) => !droppedSet.has(i));
  const finalEstimate = estimateMessagesTokens(filtered);

  return {
    estimatedTokens: finalEstimate,
    safeInputTokens: targetSafe,
    overBudget: true,
    messages: filtered,
    modelOverride: upgrade ?? null,
    droppedCount: droppedIdx.length,
    action: upgrade ? "model_upgrade+truncate" : "truncate",
  };
}
