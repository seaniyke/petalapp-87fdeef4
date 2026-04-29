/**
 * Format a credit amount for display.
 *
 * - Whole numbers render without decimals: 5 -> "5".
 * - Fractional amounts render truncated (NOT rounded) to one decimal:
 *     205.5199999 -> "205.5", 1.99 -> "1.9".
 *   Truncation avoids ever showing the user more credits than they have.
 * - Tiny floating-point noise is squashed.
 */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Truncate toward zero at 1 decimal place — never round up.
  const truncated = Math.trunc(n * 10) / 10;
  if (Number.isInteger(truncated)) return String(truncated);
  return truncated.toFixed(1);
}

/** "1 credit" / "1.92 credits". */
export function formatCreditsLabel(n: number): string {
  const formatted = formatCredits(n);
  return `${formatted} credit${formatted === "1" ? "" : "s"}`;
}
