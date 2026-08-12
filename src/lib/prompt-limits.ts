/** Shared limits for user-authored build instructions. */
export const MAX_USER_PROMPT_CHARS = 100_000;

/**
 * A final memory-safety ceiling. Normal long briefs are handled by the context
 * budget; only payloads far beyond a practical product brief are rejected.
 */
export const MAX_USER_PROMPT_HARD_CEILING_CHARS = 250_000;

export function promptExceedsHardCeiling(value: string): boolean {
  return value.length > MAX_USER_PROMPT_HARD_CEILING_CHARS;
}