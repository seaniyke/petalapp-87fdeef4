/**
 * Format a credit amount for display.
 *
 * - Whole numbers render without decimals: 5 -> "5".
 * - Fractional amounts render with two decimal places: 1.9 -> "1.90".
 * - Tiny floating-point noise (e.g. 1.9000000001) is squashed.
 */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

/** "1 credit" / "1.92 credits". */
export function formatCreditsLabel(n: number): string {
  const formatted = formatCredits(n);
  return `${formatted} credit${formatted === "1" ? "" : "s"}`;
}
