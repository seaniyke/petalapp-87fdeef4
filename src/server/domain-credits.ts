/** Cash cost in USD cents → whole credits, rounded up. */
export function creditsForUsdCents(usdCents: number, usdCentsPerCredit: number): number {
  const rate = usdCentsPerCredit > 0 ? usdCentsPerCredit : 15;
  return Math.max(1, Math.ceil(usdCents / rate));
}
