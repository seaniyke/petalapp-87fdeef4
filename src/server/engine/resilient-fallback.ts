/**
 * Resilient delivery fallback: a file that still fails verification at commit
 * may only return to its PRIOR VERIFIED content (the version the customer
 * already had). No placeholder or stand-in pages are ever produced — a page
 * that never existed before must be finished by the build loop, not faked.
 * Pure and deterministic.
 */
type F = { path: string; content: string };

export function resilientFallback(path: string, tree: F[], baseline: F[]): string | null {
  const prior = baseline.find((f) => f.path === path);
  const current = tree.find((f) => f.path === path);
  if (!current || !prior) return null;
  return prior.content !== current.content ? prior.content : null;
}
